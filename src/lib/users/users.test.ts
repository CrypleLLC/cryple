import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveServerAuthToken } from '@/lib/pin';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import type { AuthedContext } from '@/lib/context';
import {
  deleteAccount,
  enableSecondFactor,
  fetchAccountMode,
  getMe,
  getPublicKeys,
  lookupUsername,
  rotateSecondFactor,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const userAddress = vectors.seed_and_user_address.user_address;
const pin = vectors.server_auth_token.pin;
const currentToken = vectors.server_auth_token.server_auth_token_hex;

const publicKey = (await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex)))
  .identity.publicKeyUncompressed;

const NEW_PIN = '719284';

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method as string,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        headers: init.headers as Record<string, string>,
      });
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

  return calls;
}

async function newContext(paranoid = true): Promise<AuthedContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid };
}

const meBody = (has_password: boolean) => ({
  status: 200,
  body: {
    message: 'Account retrieved successfully',
    data: {
      user_address: userAddress,
      username: '62a772f85e4b',
      uuid: '0c892e57-93cf-423a-a9e9-fee5a9f87681',
      has_password,
      created_at: '2026-07-26T12:00:00Z',
    },
  },
});

afterEach(() => vi.unstubAllGlobals());

describe('GET /users/me is the source of truth for the mode', () => {
  it('reads the account record with the bearer token', async () => {
    const calls = mockFetch(meBody(false));
    const account = await getMe(await newContext());

    expect(calls[0].url).toBe('http://localhost:8080/users/me');
    expect(calls[0].headers.Authorization).toBe('Bearer jwt-token');
    expect(account.has_password).toBe(false);
    expect(account.username).toBe('62a772f85e4b');
  });

  it('maps has_password to the Paranoid flag rather than guessing', async () => {
    mockFetch(meBody(true));
    expect((await fetchAccountMode(await newContext())).paranoid).toBe(true);

    mockFetch(meBody(false));
    expect((await fetchAccountMode(await newContext())).paranoid).toBe(false);
  });
});

describe('lookup and public keys', () => {
  it('resolves an address to a username over the public route', async () => {
    const calls = mockFetch({
      status: 200,
      body: { message: 'ok', data: { username: '62a772f85e4b' } },
    });
    expect(await lookupUsername(userAddress)).toBe('62a772f85e4b');
    expect(calls[0].url).toBe(
      `http://localhost:8080/users/lookup?address=${userAddress}`,
    );
    expect(calls[0].headers).not.toHaveProperty('Authorization');
  });

  it('rejects a malformed address before sending', async () => {
    mockFetch({ status: 200, body: {} });
    await expect(lookupUsername('nope')).rejects.toThrow(/64 lowercase hex/);
  });

  it('fetches a subject’s hybrid encryption keys by canonical uuid', async () => {
    const uuid = '0f5c8b1e-4f89-11d3-9a0c-0305e82c3301';
    const calls = mockFetch({
      status: 200,
      body: {
        message: 'ok',
        data: {
          uuid,
          encryption_public_key_x25519: 'x',
          encryption_public_key_mlkem: 'm',
        },
      },
    });

    expect((await getPublicKeys(await newContext(), uuid)).uuid).toBe(uuid);
    expect(calls[0].url).toContain(`/users/${uuid}/public-keys`);
  });

  it('refuses a non-canonical uuid before sending', async () => {
    mockFetch({ status: 200, body: {} });
    await expect(
      getPublicKeys(await newContext(), '0F5C8B1E-4F89-11D3-9A0C-0305E82C3301'),
    ).rejects.toThrow(/canonical/);
  });
});

describe('POST /users/second-factor — Standard to Paranoid', () => {
  it('signs the new token itself, and sends no password', async () => {
    const calls = mockFetch({ status: 204 });
    const context = await newContext(false);

    const outcome = await enableSecondFactor(context, NEW_PIN);
    expect(outcome).toEqual({ status: 'enabled' });

    const body = calls[0].body!;
    const newToken = await deriveServerAuthToken(NEW_PIN, userAddress);

    expect(body.new_password).toBe(newToken);
    expect(body).not.toHaveProperty('password');
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'enable-second-factor',
          [newToken],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('updates the held token so the PIN is never re-prompted', async () => {
    mockFetch({ status: 204 });
    const context = await newContext(false);

    expect(context.session.serverAuthToken()).toBe(currentToken);
    await enableSecondFactor(context, NEW_PIN);
    expect(context.session.serverAuthToken()).toBe(
      await deriveServerAuthToken(NEW_PIN, userAddress),
    );
  });

  it('resolves the ambiguous 401 on retry with GET /users/me instead of looping', async () => {
    const calls = mockFetch(
      { status: 401, body: { code: 'INVALID_CREDENTIALS' } },
      meBody(true),
    );
    const context = await newContext(false);

    expect(await enableSecondFactor(context, NEW_PIN)).toEqual({
      status: 'already-enabled',
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('/users/me');
  });

  it('rethrows the 401 when the read-back says the factor never landed', async () => {
    mockFetch({ status: 401, body: { code: 'INVALID_CREDENTIALS' } }, meBody(false));
    await expect(enableSecondFactor(await newContext(false), NEW_PIN)).rejects.toThrow(
      /INVALID_CREDENTIALS/,
    );
  });
});

describe('PUT /users/password — rotation', () => {
  it('presents the current token and signs the new one', async () => {
    const calls = mockFetch({ status: 204 });
    const context = await newContext(true);

    await rotateSecondFactor(context, NEW_PIN);

    const body = calls[0].body!;
    const newToken = await deriveServerAuthToken(NEW_PIN, userAddress);

    expect(calls[0].method).toBe('PUT');
    expect(body.password).toBe(currentToken);
    expect(body.new_password).toBe(newToken);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'rotate-second-factor',
          [newToken],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('replaces the held token after a successful rotation', async () => {
    mockFetch({ status: 204 });
    const context = await newContext(true);
    await rotateSecondFactor(context, NEW_PIN);
    expect(context.session.serverAuthToken()).toBe(
      await deriveServerAuthToken(NEW_PIN, userAddress),
    );
  });
});

describe('DELETE /users', () => {
  it('sends the required body carrying the account-delete signature', async () => {
    const calls = mockFetch({ status: 204 });
    const context = await newContext(true);

    await deleteAccount(context);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('DELETE');
    expect(body).toBeDefined();
    expect(body.password).toBe(currentToken);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'account-delete',
          [userAddress],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('omits password on a Standard account', async () => {
    const calls = mockFetch({ status: 204 });
    await deleteAccount(await newContext(false));
    expect(calls[0].body).not.toHaveProperty('password');
  });

  it('drops the token and locks the keystore afterwards', async () => {
    mockFetch({ status: 204 });
    const context = await newContext(true);
    await deleteAccount(context);

    expect(context.tokens.get()).toBeUndefined();
    expect(context.session.isUnlocked).toBe(false);
  });

  it('treats the retry 401 as success — the account row is already gone', async () => {
    mockFetch({ status: 401, body: { code: 'INVALID_CREDENTIALS' } });
    const context = await newContext(true);

    await expect(deleteAccount(context)).resolves.toBeUndefined();
    expect(context.tokens.get()).toBeUndefined();
  });
});

describe('there is no way to turn the second factor off', () => {
  it('exports no disable affordance', async () => {
    const users = await import('./index');
    const names = Object.keys(users).join(' ');
    expect(names).not.toMatch(/disable|removeSecondFactor|downgrade/i);
  });
});
