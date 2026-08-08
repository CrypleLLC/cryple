import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import type { VaultStorage } from '@/lib/pin';
import {
  clearModeHint,
  enrolAccount,
  MODE_HINT_STORAGE_KEY,
  readModeHint,
  SignInFailedError,
  signInAttemptOrder,
  signInWithModeDetection,
  writeModeHint,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const userAddress = vectors.seed_and_user_address.user_address;

function memoryStorage(): VaultStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: init.method as string,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
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

function account(hasPassword: boolean) {
  return {
    data: {
      user_address: userAddress,
      username: '3f1c8a2b9d4e',
      uuid: '0f5c8b1e-4f89-11d3-9a0c-0305e82c3301',
      has_password: hasPassword,
      created_at: '2026-07-26T12:00:00Z',
    },
  };
}

async function newSession(): Promise<SessionKeystore> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  return session;
}

afterEach(() => vi.unstubAllGlobals());

describe('the stored mode hint', () => {
  it('round-trips both modes', () => {
    const storage = memoryStorage();

    writeModeHint(true, storage);
    expect(readModeHint(storage)).toBe('paranoid');

    writeModeHint(false, storage);
    expect(readModeHint(storage)).toBe('standard');
  });

  it('reports nothing for an absent or corrupted value', () => {
    const storage = memoryStorage();
    expect(readModeHint(storage)).toBeUndefined();

    storage.setItem(MODE_HINT_STORAGE_KEY, 'something-else');
    expect(readModeHint(storage)).toBeUndefined();
  });

  it('clears', () => {
    const storage = memoryStorage();
    writeModeHint(true, storage);
    clearModeHint(storage);
    expect(readModeHint(storage)).toBeUndefined();
  });

  it('tries the hinted mode first and still tries the other', () => {
    expect(signInAttemptOrder('standard')).toEqual([false, true]);
    expect(signInAttemptOrder('paranoid')).toEqual([true, false]);
    expect(signInAttemptOrder(undefined)).toHaveLength(2);
  });
});

describe('signing in without knowing the mode', () => {
  it('sends the token on the first attempt when the hint says Paranoid', async () => {
    const calls = mockFetch(
      { status: 200, body: { data: { access_token: 'jwt' } } },
      { status: 200, body: account(true) },
    );

    const result = await signInWithModeDetection({
      session: await newSession(),
      tokens: new TokenStore(),
      hint: 'paranoid',
    });

    expect(calls[0].body).toHaveProperty('password');
    expect(result.paranoid).toBe(true);
  });

  it('omits the token when the hint says Standard', async () => {
    const calls = mockFetch(
      { status: 200, body: { data: { access_token: 'jwt' } } },
      { status: 200, body: account(false) },
    );

    const result = await signInWithModeDetection({
      session: await newSession(),
      tokens: new TokenStore(),
      hint: 'standard',
    });

    expect(calls[0].body).not.toHaveProperty('password');
    expect(result.paranoid).toBe(false);
  });

  it('falls back to the other mode with a fresh challenge when the hint is wrong', async () => {
    const calls = mockFetch(
      { status: 404, body: { code: 'NOT_FOUND' } },
      { status: 200, body: { data: { access_token: 'jwt' } } },
      { status: 200, body: account(false) },
    );

    const result = await signInWithModeDetection({
      session: await newSession(),
      tokens: new TokenStore(),
      hint: 'paranoid',
    });

    expect(calls[0].body).toHaveProperty('password');
    expect(calls[1].body).not.toHaveProperty('password');
    expect(calls[0].body!.challenge).not.toBe(calls[1].body!.challenge);
    expect(result.paranoid).toBe(false);
  });

  it('reads the mode from has_password, not from what happened to work', async () => {
    mockFetch(
      { status: 200, body: { data: { access_token: 'jwt' } } },
      { status: 200, body: account(true) },
    );

    const result = await signInWithModeDetection({
      session: await newSession(),
      tokens: new TokenStore(),
      hint: 'paranoid',
    });

    expect(result.account.has_password).toBe(true);
    expect(result.paranoid).toBe(result.account.has_password);
  });

  it('fails with one generic message when both modes are refused', async () => {
    mockFetch({ status: 404, body: { code: 'NOT_FOUND' } });

    const failure = signInWithModeDetection({
      session: await newSession(),
      tokens: new TokenStore(),
      hint: 'paranoid',
    });

    await expect(failure).rejects.toThrow(SignInFailedError);
    await expect(failure).rejects.toMatchObject({
      userMessage: 'We could not sign you in. Check your recovery phrase and PIN, then try again.',
    });
  });

  it('does not swallow a real transport failure as a wrong-mode guess', async () => {
    mockFetch({ status: 500, body: { code: 'INTERNAL_ERROR' } });

    await expect(
      signInWithModeDetection({
        session: await newSession(),
        tokens: new TokenStore(),
        hint: 'paranoid',
      }),
    ).rejects.not.toBeInstanceOf(SignInFailedError);
  });
});

describe('enrolling a new account', () => {
  it('reports the 201 as created and confirms the mode from /users/me', async () => {
    const calls = mockFetch(
      { status: 201, body: { data: { access_token: 'jwt' } } },
      { status: 200, body: account(true) },
    );

    const result = await enrolAccount({
      session: await newSession(),
      tokens: new TokenStore(),
      paranoid: true,
    });

    expect(result.created).toBe(true);
    expect(result.paranoid).toBe(true);
    expect(calls[0].url).toContain('/sign-up');
    expect(calls[1].url).toContain('/users/me');
  });

  it('reports the 200 as a restore of an account that already existed', async () => {
    mockFetch(
      { status: 200, body: { data: { access_token: 'jwt' } } },
      { status: 200, body: account(false) },
    );

    const result = await enrolAccount({
      session: await newSession(),
      tokens: new TokenStore(),
      paranoid: false,
    });

    expect(result.created).toBe(false);
  });

  it('enrols all three public keys', async () => {
    const calls = mockFetch(
      { status: 201, body: { data: { access_token: 'jwt' } } },
      { status: 200, body: account(false) },
    );

    await enrolAccount({
      session: await newSession(),
      tokens: new TokenStore(),
      paranoid: false,
    });

    const body = calls[0].body!;
    expect(body.public_key).toBe(vectors.identity_key_p256.public_key_spki_base64);
    expect(body.encryption_public_key_x25519).toBe(vectors.x25519_key.public_key_base64);
    expect(body.encryption_public_key_mlkem).toBe(vectors.mlkem768_key.public_key_base64);
  });
});
