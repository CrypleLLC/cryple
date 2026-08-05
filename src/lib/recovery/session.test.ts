import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToBase64 } from '@/lib/encoding';
import {
  buildRecoveryVault,
  completeRecovery,
  disposeEphemeralKeys,
  getRecoverySession,
  getRecoveryVault,
  hasReachedThreshold,
  isSessionExpired,
  pollRecoverySession,
  RecoverySessionCryptoUnspecifiedError,
  SessionExpiredError,
  startRecovery,
  unspecifiedRecoverySessionCrypto,
  type EphemeralSessionKeys,
  type RecoverySession,
  type RecoverySessionCrypto,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const SESSION_ID = '4d7a1b2c-4f89-11d3-9a0c-0305e82c3301';

/**
 * Stands in for the unspecified recovery-session binding so the transport and
 * reconstruction paths can be exercised. It stores shares in the clear and is
 * NOT a protocol proposal — it must never leave this test file.
 */
function fakeSessionCryptoForTestsOnly(): RecoverySessionCrypto {
  return {
    async generateEphemeralKeys() {
      return {
        publicKeyField: 'fake-ephemeral-public-key',
        x25519PrivateKey: new Uint8Array(32).fill(1),
        mlkemSecretKey: new Uint8Array(64).fill(2),
      };
    },
    async rewrapToSession(share) {
      return bytesToBase64(share);
    },
    async unwrapShare(reEncryptedShare) {
      return Uint8Array.from(atob(reEncryptedShare), (c) => c.charCodeAt(0));
    },
  };
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
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

function session(overrides: Partial<RecoverySession> = {}): RecoverySession {
  return {
    id: SESSION_ID,
    n_shares: 3,
    k_threshold: 2,
    status: 'pending',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the recovery-session crypto seam ships unimplemented', () => {
  it('throws rather than inventing an ephemeral key encoding', async () => {
    await expect(unspecifiedRecoverySessionCrypto.generateEphemeralKeys()).rejects.toThrow(
      RecoverySessionCryptoUnspecifiedError,
    );
  });

  it('names both halves of the gap', async () => {
    const error = await unspecifiedRecoverySessionCrypto
      .generateEphemeralKeys()
      .catch((e) => e);

    expect(error.message).toContain('X25519');
    expect(error.message).toContain('ML-KEM-768');
    expect(error.message).toContain('info string');
    expect(error.message).toContain('user_address');
  });

  it('is what startRecovery hits when no implementation is supplied', async () => {
    mockFetch({ status: 201, body: { data: session() } });
    await expect(startRecovery({ username: 'alice' })).rejects.toThrow(
      RecoverySessionCryptoUnspecifiedError,
    );
  });

  it('blocks the unwrap too', async () => {
    await expect(
      unspecifiedRecoverySessionCrypto.unwrapShare(
        'x',
        {} as EphemeralSessionKeys,
        { senderUserAddress: 'a', recipientUserAddress: 'b' },
      ),
    ).rejects.toThrow(RecoverySessionCryptoUnspecifiedError);
  });
});

describe('POST /recovery/request', () => {
  it('is public — it carries no Authorization header, because the seed is lost', async () => {
    const calls = mockFetch({ status: 201, body: { data: session() } });

    await startRecovery({ username: 'alice1234abcd', crypto: fakeSessionCryptoForTestsOnly() });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({
      username: 'alice1234abcd',
      ephemeral_public_key: 'fake-ephemeral-public-key',
    });
  });

  it('carries no signature — there is no key to sign with', async () => {
    const calls = mockFetch({ status: 201, body: { data: session() } });
    await startRecovery({ username: 'alice', crypto: fakeSessionCryptoForTestsOnly() });

    expect(calls[0].body).not.toHaveProperty('signature');
    expect(calls[0].body).not.toHaveProperty('challenge');
  });

  it('returns the session and the ephemeral keys to hold for the session', async () => {
    mockFetch({ status: 201, body: { data: session() } });
    const { session: created, keys } = await startRecovery({
      username: 'alice',
      crypto: fakeSessionCryptoForTestsOnly(),
    });

    expect(created.id).toBe(SESSION_ID);
    expect(created.k_threshold).toBe(2);
    expect(keys.x25519PrivateKey).toHaveLength(32);
  });
});

describe('polling the session', () => {
  it('withholds shares below the threshold', async () => {
    mockFetch({ status: 200, body: { data: session() } });
    const current = await getRecoverySession(SESSION_ID);

    expect(current.status).toBe('pending');
    expect(current.shares).toBeUndefined();
    expect(hasReachedThreshold(current)).toBe(false);
  });

  it('returns every collected share at once when the threshold is met', async () => {
    const collected = session({
      status: 'shares_collected',
      shares: [
        { re_encrypted_share: 'a', submitted_at: '2026-07-26T12:05:00Z' },
        { re_encrypted_share: 'b', submitted_at: '2026-07-26T12:07:00Z' },
      ],
    });
    mockFetch({ status: 200, body: { data: collected } });

    const current = await getRecoverySession(SESSION_ID);
    expect(hasReachedThreshold(current)).toBe(true);
    expect(current.shares).toHaveLength(2);
  });

  it('maps a 409 to an explicit expiry, which needs a fresh request', async () => {
    mockFetch({ status: 409, body: { code: 'CONFLICT' } });
    await expect(getRecoverySession(SESSION_ID)).rejects.toThrow(SessionExpiredError);
  });

  it('refuses a non-canonical session id before sending', async () => {
    mockFetch({ status: 200, body: { data: session() } });
    await expect(getRecoverySession(SESSION_ID.toUpperCase())).rejects.toThrow(/canonical/);
  });

  it('detects local expiry from expires_at', () => {
    const expired = session({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(isSessionExpired(expired)).toBe(true);
    expect(isSessionExpired(session())).toBe(false);
  });

  it('polls until the threshold is reached, reporting each update', async () => {
    const collected = session({
      status: 'shares_collected',
      shares: [{ re_encrypted_share: 'a', submitted_at: 'x' }],
    });
    mockFetch(
      { status: 200, body: { data: session() } },
      { status: 200, body: { data: session() } },
      { status: 200, body: { data: collected } },
    );

    const seen: string[] = [];
    const result = await pollRecoverySession(SESSION_ID, {
      intervalMs: 1,
      onUpdate: (s) => seen.push(s.status),
    });

    expect(seen).toEqual(['pending', 'pending', 'shares_collected']);
    expect(result.status).toBe('shares_collected');
  });

  it('stops polling once the session has expired', async () => {
    mockFetch({
      status: 200,
      body: { data: session({ expires_at: new Date(Date.now() - 1).toISOString() }) },
    });
    await expect(pollRecoverySession(SESSION_ID, { intervalMs: 1 })).rejects.toThrow(
      SessionExpiredError,
    );
  });

  it('honours an abort signal so polling stops when the screen closes', async () => {
    mockFetch({ status: 200, body: { data: session() } });
    const controller = new AbortController();
    controller.abort();

    await expect(
      pollRecoverySession(SESSION_ID, { intervalMs: 1, signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
  });
});

describe('GET /recovery/vault', () => {
  it('fetches the owner blob by username, unauthenticated', async () => {
    const calls = mockFetch({
      status: 200,
      body: {
        data: { encrypted_seed: 'blob', n_shares: 3, k_threshold: 2, version: 'v1' },
      },
    });

    const vault = await getRecoveryVault('alice1234abcd');
    expect(calls[0].url).toBe(
      'http://localhost:8080/v1/recovery/vault?username=alice1234abcd',
    );
    expect(vault.k_threshold).toBe(2);
  });
});

describe('reconstruction, once shares are in hand', () => {
  it('rebuilds the seed phrase from the session shares plus the Recovery Kit share', async () => {
    const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, {
      shares: 3,
      threshold: 2,
    });

    const collected = session({
      status: 'shares_collected',
      shares: [
        { re_encrypted_share: bytesToBase64(shares[1].bytes), submitted_at: 'x' },
      ],
    });

    const recovered = await completeRecovery({
      session: collected,
      keys: await fakeSessionCryptoForTestsOnly().generateEphemeralKeys(),
      vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 2, version: 'v1' },
      shareContext: { senderUserAddress: 'a'.repeat(64), recipientUserAddress: 'b'.repeat(64) },
      ownShare: shares[0].bytes,
      crypto: fakeSessionCryptoForTestsOnly(),
    });

    expect(recovered).toBe(mnemonic);
  });

  it('rebuilds from two guardian shares with no Recovery Kit copy', async () => {
    const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, {
      shares: 3,
      threshold: 2,
    });

    const collected = session({
      status: 'shares_collected',
      shares: [
        { re_encrypted_share: bytesToBase64(shares[1].bytes), submitted_at: 'x' },
        { re_encrypted_share: bytesToBase64(shares[2].bytes), submitted_at: 'y' },
      ],
    });

    expect(
      await completeRecovery({
        session: collected,
        keys: await fakeSessionCryptoForTestsOnly().generateEphemeralKeys(),
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 2, version: 'v1' },
        shareContext: {
          senderUserAddress: 'a'.repeat(64),
          recipientUserAddress: 'b'.repeat(64),
        },
        crypto: fakeSessionCryptoForTestsOnly(),
      }),
    ).toBe(mnemonic);
  });

  it('refuses to reconstruct before the threshold is met', async () => {
    await expect(
      completeRecovery({
        session: session(),
        keys: await fakeSessionCryptoForTestsOnly().generateEphemeralKeys(),
        vault: { encrypted_seed: 'x', n_shares: 3, k_threshold: 2, version: 'v1' },
        shareContext: { senderUserAddress: 'a', recipientUserAddress: 'b' },
        crypto: fakeSessionCryptoForTestsOnly(),
      }),
    ).rejects.toThrow(/threshold/);
  });

  it('refuses when fewer shares than k are in hand', async () => {
    const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, {
      shares: 3,
      threshold: 3,
    });

    await expect(
      completeRecovery({
        session: session({
          status: 'shares_collected',
          shares: [{ re_encrypted_share: bytesToBase64(shares[1].bytes), submitted_at: 'x' }],
        }),
        keys: await fakeSessionCryptoForTestsOnly().generateEphemeralKeys(),
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 3, version: 'v1' },
        shareContext: { senderUserAddress: 'a', recipientUserAddress: 'b' },
        crypto: fakeSessionCryptoForTestsOnly(),
      }),
    ).rejects.toThrow(/need 3/);
  });
});

describe('ephemeral key hygiene', () => {
  it('zeroes the session keys when the flow ends', async () => {
    const keys = await fakeSessionCryptoForTestsOnly().generateEphemeralKeys();
    disposeEphemeralKeys(keys);

    expect([...keys.x25519PrivateKey].every((b) => b === 0)).toBe(true);
    expect([...keys.mlkemSecretKey].every((b) => b === 0)).toBe(true);
  });
});
