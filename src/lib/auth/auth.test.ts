import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore, GENERIC_AUTH_FAILURE } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { buildAuthPayload, verifyPayload } from '@/lib/signing';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import { AuthRejectedError, restore, signIn, signOut, signUp } from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const userAddress = vectors.seed_and_user_address.user_address;
const pin = vectors.server_auth_token.pin;
const serverAuthToken = vectors.server_auth_token.server_auth_token_hex;
const identityVector = vectors.identity_key_p256;

const publicKey = (await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex)))
  .identity.publicKeyUncompressed;

async function newSession() {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  return session;
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const bodies: Record<string, unknown>[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      const spec = specs[Math.min(index++, specs.length - 1)];
      const text = spec.body === undefined ? '' : JSON.stringify(spec.body);
      return {
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        text: async () => text,
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );

  return bodies;
}

const created = { status: 201, body: { message: 'Account created', data: { access_token: 'jwt-new' } } };
const existing = {
  status: 200,
  body: { message: 'Authentication successful', data: { access_token: 'jwt-existing' } },
};
const rejected = { status: 404, body: { code: 'NOT_FOUND' } };

afterEach(() => vi.unstubAllGlobals());

describe('sign-up enrolls all three public keys', () => {
  it('sends the identity key as SPKI base64 and both encryption keys', async () => {
    const bodies = mockFetch(created);
    const session = await newSession();
    await signUp({ session, paranoid: false });

    expect(bodies[0]).toMatchObject({
      user_address: userAddress,
      public_key: identityVector.public_key_spki_base64,
      encryption_public_key_x25519: vectors.x25519_key.public_key_base64,
      encryption_public_key_mlkem: vectors.mlkem768_key.public_key_base64,
    });
  });

  it('signs challenge:timestamp with the identity key', async () => {
    const bodies = mockFetch(created);
    const session = await newSession();
    await signUp({ session, paranoid: false });

    const { challenge, timestamp, signature } = bodies[0] as {
      challenge: string;
      timestamp: number;
      signature: string;
    };
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(timestamp)).toBe(true);
    expect(verifyPayload(buildAuthPayload(challenge, timestamp), signature, publicKey)).toBe(true);
  });

  it('reports 201 as created and 200 as already existed — both carry a token', async () => {
    mockFetch(created);
    const first = await signUp({ session: await newSession(), paranoid: false });
    expect(first).toEqual({ accessToken: 'jwt-new', created: true });

    mockFetch(existing);
    const second = await signUp({ session: await newSession(), paranoid: false });
    expect(second).toEqual({ accessToken: 'jwt-existing', created: false });
  });

  it('chooses the mode by sending password or not', async () => {
    const standard = mockFetch(created);
    await signUp({ session: await newSession(), paranoid: false });
    expect(standard[0]).not.toHaveProperty('password');

    const paranoid = mockFetch(created);
    await signUp({ session: await newSession(), paranoid: true });
    expect(paranoid[0].password).toBe(serverAuthToken);
  });

  it('enrols a Standard account from a session that never saw a PIN', async () => {
    const bodies = mockFetch(created);
    const session = new SessionKeystore({ idleTimeoutMs: 0 });
    await session.unlockWithMnemonic(mnemonic);

    await signUp({ session, paranoid: false });

    expect(bodies[0]).toMatchObject({ user_address: userAddress });
    expect(bodies[0]).not.toHaveProperty('password');
  });

  it('refuses to enrol a Paranoid account from a session with no second factor', async () => {
    mockFetch(created);
    const session = new SessionKeystore({ idleTimeoutMs: 0 });
    await session.unlockWithMnemonic(mnemonic);

    await expect(signUp({ session, paranoid: true })).rejects.toThrow(/Server_Auth_Token/);
  });

  it('never puts the PIN or the seed phrase on the wire', async () => {
    const bodies = mockFetch(created);
    await signUp({ session: await newSession(), paranoid: true });

    const serialized = JSON.stringify(bodies[0]);
    expect(serialized).not.toContain(pin);
    expect(serialized).not.toContain('abandon');
    expect(serialized).not.toContain(identityVector.private_key_hex);
  });
});

describe('sign-in', () => {
  it('sends only the address and the envelope — no key fields', async () => {
    const bodies = mockFetch(existing);
    await signIn({ session: await newSession(), paranoid: false });

    expect(Object.keys(bodies[0]).sort()).toEqual([
      'challenge',
      'signature',
      'timestamp',
      'user_address',
    ]);
  });

  it('attaches the Server_Auth_Token on a Paranoid account', async () => {
    const bodies = mockFetch(existing);
    await signIn({ session: await newSession(), paranoid: true });
    expect(bodies[0].password).toBe(serverAuthToken);
  });
});

describe('every auth 404 renders one generic message', () => {
  it('refuses sign-in with the generic copy, never "user not found"', async () => {
    mockFetch(rejected);
    const error = await signIn({ session: await newSession(), paranoid: false }).catch((e) => e);

    expect(error).toBeInstanceOf(AuthRejectedError);
    expect(error.userMessage).toBe(GENERIC_AUTH_FAILURE);
    expect(error.userMessage).not.toMatch(/not found|no such|exist/i);
  });

  it('surfaces the derivation-mismatch diagnostic on a rejected sign-up', async () => {
    mockFetch(rejected);
    const error = await signUp({ session: await newSession(), paranoid: false }).catch((e) => e);

    expect(error).toBeInstanceOf(AuthRejectedError);
    expect(error.userMessage).toBe(GENERIC_AUTH_FAILURE);
    expect(error.diagnostic).toMatch(/derivation mismatch|test-vectors/i);
  });
});

describe('restore on a new device', () => {
  it('re-runs sign-up and reports that the account already existed', async () => {
    mockFetch(existing);
    const outcome = await restore({ session: await newSession(), paranoid: false });
    expect(outcome).toEqual({
      accessToken: 'jwt-existing',
      created: false,
      accountExisted: true,
    });
  });

  it('reports a 201 as "no account existed for this seed"', async () => {
    mockFetch(created);
    const outcome = await restore({ session: await newSession(), paranoid: false });
    expect(outcome.accountExisted).toBe(false);
  });

  it('re-sends all three keys so the server can compare them', async () => {
    const bodies = mockFetch(existing);
    await restore({ session: await newSession(), paranoid: false });
    expect(bodies[0]).toHaveProperty('encryption_public_key_x25519');
    expect(bodies[0]).toHaveProperty('encryption_public_key_mlkem');
  });
});

describe('token lifecycle', () => {
  it('stores the token from a successful auth', async () => {
    mockFetch(created);
    const tokens = new TokenStore();
    await signUp({ session: await newSession(), paranoid: false, tokens });
    expect(tokens.get()).toBe('jwt-new');
  });

  it('leaves the store untouched when auth is rejected', async () => {
    mockFetch(rejected);
    const tokens = new TokenStore();
    await signIn({ session: await newSession(), paranoid: false, tokens }).catch(() => undefined);
    expect(tokens.get()).toBeUndefined();
  });

  it('signs out by dropping our copy and locking the keystore', async () => {
    mockFetch(created);
    const tokens = new TokenStore();
    const session = await newSession();
    await signUp({ session, paranoid: false, tokens });

    signOut(tokens, session);

    expect(tokens.get()).toBeUndefined();
    expect(session.isUnlocked).toBe(false);
  });
});

describe('a fresh challenge per attempt', () => {
  it('never reuses the triple across a retry', async () => {
    const bodies = mockFetch(rejected, created);

    const session = await newSession();
    await signIn({ session, paranoid: false }).catch(() => undefined);
    await signIn({ session, paranoid: false }).catch(() => undefined);

    expect(bodies[0].challenge).not.toBe(bodies[1].challenge);
    expect(bodies[0].signature).not.toBe(bodies[1].signature);
  });
});
