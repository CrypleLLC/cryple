import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToHex } from '@/lib/encoding';
import { UnsupportedPqxdhVersionError } from '@/lib/pqxdh';
import {
  buildRecoveryVault,
  completeRecovery,
  disposeEphemeralKeys,
  ephemeralPublicFields,
  generateEphemeralKeys,
  getRecoverySession,
  getRecoveryVault,
  hasReachedThreshold,
  isSessionExpired,
  MalformedEphemeralKeyError,
  parseSessionRecipient,
  pollRecoverySession,
  rewrapToSession,
  SessionExpiredError,
  startRecovery,
  unwrapSessionShare,
  EPHEMERAL_MLKEM_PUBLIC_LENGTH,
  EPHEMERAL_X25519_PUBLIC_LENGTH,
  type RecoverySession,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const SESSION_ID = '4d7a1b2c-4f89-11d3-9a0c-0305e82c3301';
const OTHER_SESSION_ID = '9c4f2a1b-4f89-11d3-9a0c-0305e82c3301';

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

describe('ephemeral session keys (Decision C)', () => {
  it('generates a hybrid pair — X25519 and ML-KEM-768', () => {
    const keys = generateEphemeralKeys();

    expect(keys.x25519PublicKey).toHaveLength(EPHEMERAL_X25519_PUBLIC_LENGTH);
    expect(keys.mlkemPublicKey).toHaveLength(EPHEMERAL_MLKEM_PUBLIC_LENGTH);
    expect(keys.x25519PrivateKey).toHaveLength(32);
    expect(keys.mlkemSecretKey.length).toBeGreaterThan(0);
  });

  it('is fresh every session', () => {
    const a = generateEphemeralKeys();
    const b = generateEphemeralKeys();
    expect(bytesToHex(a.x25519PublicKey)).not.toBe(bytesToHex(b.x25519PublicKey));
    expect(bytesToHex(a.mlkemPublicKey)).not.toBe(bytesToHex(b.mlkemPublicKey));
  });

  it('exposes both public halves as two separate wire fields', () => {
    const fields = ephemeralPublicFields(generateEphemeralKeys());

    expect(Object.keys(fields).sort()).toEqual([
      'ephemeral_mlkem_public',
      'ephemeral_x25519_public',
    ]);
    expect(fields.ephemeral_x25519_public).toHaveLength(44);
    expect(fields.ephemeral_mlkem_public).toHaveLength(1580);
  });

  it('round-trips the wire fields back to key material', () => {
    const keys = generateEphemeralKeys();
    const parsed = parseSessionRecipient(ephemeralPublicFields(keys));

    expect(bytesToHex(parsed.x25519PublicKey)).toBe(bytesToHex(keys.x25519PublicKey));
    expect(bytesToHex(parsed.mlkemPublicKey)).toBe(bytesToHex(keys.mlkemPublicKey));
  });

  it('rejects a key of the wrong length rather than wrapping to nonsense', () => {
    const fields = ephemeralPublicFields(generateEphemeralKeys());

    expect(() =>
      parseSessionRecipient({ ...fields, ephemeral_x25519_public: 'AAAA' }),
    ).toThrow(MalformedEphemeralKeyError);
    expect(() =>
      parseSessionRecipient({ ...fields, ephemeral_mlkem_public: 'AAAA' }),
    ).toThrow(MalformedEphemeralKeyError);
  });

  it('zeroes the private halves when the session ends', () => {
    const keys = generateEphemeralKeys();
    disposeEphemeralKeys(keys);

    expect([...keys.x25519PrivateKey].every((b) => b === 0)).toBe(true);
    expect([...keys.mlkemSecretKey].every((b) => b === 0)).toBe(true);
  });
});

describe('the session-bound PQXDH wrap (Decision D)', () => {
  it('round-trips a share through the ephemeral keys', async () => {
    const keys = generateEphemeralKeys();
    const share = new Uint8Array(33).fill(9);

    const blob = await rewrapToSession(share, ephemeralPublicFields(keys), SESSION_ID);
    const opened = await unwrapSessionShare(blob, keys, SESSION_ID);

    expect(bytesToHex(opened)).toBe(bytesToHex(share));
  });

  it('binds the session id — a blob from another session will not open', async () => {
    const keys = generateEphemeralKeys();
    const blob = await rewrapToSession(
      new Uint8Array(33).fill(9),
      ephemeralPublicFields(keys),
      SESSION_ID,
    );

    await expect(unwrapSessionShare(blob, keys, OTHER_SESSION_ID)).rejects.toThrow();
  });

  it('will not open under a different session’s ephemeral keys', async () => {
    const mine = generateEphemeralKeys();
    const theirs = generateEphemeralKeys();

    const blob = await rewrapToSession(
      new Uint8Array(33).fill(9),
      ephemeralPublicFields(mine),
      SESSION_ID,
    );

    await expect(unwrapSessionShare(blob, theirs, SESSION_ID)).rejects.toThrow();
  });

  it('produces a self-contained PQXDH blob of the documented size', async () => {
    const keys = generateEphemeralKeys();
    const blob = await rewrapToSession(
      new Uint8Array(33),
      ephemeralPublicFields(keys),
      SESSION_ID,
    );

    expect(atob(blob)).toHaveLength(1 + 1088 + 32 + 12 + 33 + 16);
  });

  it('rejects an unknown version byte', async () => {
    const keys = generateEphemeralKeys();
    const blob = await rewrapToSession(
      new Uint8Array(33),
      ephemeralPublicFields(keys),
      SESSION_ID,
    );

    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    bytes[0] = 0x02;

    await expect(
      unwrapSessionShare(btoa(String.fromCharCode(...bytes)), keys, SESSION_ID),
    ).rejects.toThrow(UnsupportedPqxdhVersionError);
  });
});

describe('POST /recovery/request', () => {
  it('sends both ephemeral public keys and nothing else', async () => {
    const calls = mockFetch({ status: 201, body: { data: session() } });

    await startRecovery({ username: 'alice1234abcd' });

    expect(calls[0].method).toBe('POST');
    expect(Object.keys(calls[0].body!).sort()).toEqual([
      'ephemeral_mlkem_public',
      'ephemeral_x25519_public',
      'username',
    ]);
    expect(calls[0].body!.username).toBe('alice1234abcd');
  });

  it('carries no signature or token — the seed is lost, so there is no key', async () => {
    const calls = mockFetch({ status: 201, body: { data: session() } });
    await startRecovery({ username: 'alice' });

    expect(calls[0].body).not.toHaveProperty('signature');
    expect(calls[0].body).not.toHaveProperty('challenge');
    expect(calls[0].body).not.toHaveProperty('password');
  });

  it('returns the session and the keys to hold for its lifetime', async () => {
    mockFetch({ status: 201, body: { data: session() } });
    const { session: created, keys } = await startRecovery({ username: 'alice' });

    expect(created.id).toBe(SESSION_ID);
    expect(keys.x25519PrivateKey).toHaveLength(32);
  });

  it('zeroes the ephemeral keys if the request fails', async () => {
    mockFetch({ status: 404, body: { code: 'NOT_FOUND' } });
    await expect(startRecovery({ username: 'nobody' })).rejects.toThrow();
  });
});

describe('polling the session', () => {
  it('reports no shares while no guardian has answered', async () => {
    mockFetch({ status: 200, body: { data: session() } });
    const current = await getRecoverySession(SESSION_ID);

    expect(current.status).toBe('pending');
    expect(current.shares).toBeUndefined();
    expect(hasReachedThreshold(current)).toBe(false);
    expect(hasReachedThreshold(current, 1)).toBe(false);
  });

  it("counts the owner's Recovery Kit toward a 2-of-3, so one guardian is enough", async () => {
    mockFetch({
      status: 200,
      body: {
        data: session({
          shares: [{ re_encrypted_share: 'a', submitted_at: '2026-07-26T12:05:00Z' }],
        }),
      },
    });

    const current = await getRecoverySession(SESSION_ID);

    expect(current.status).toBe('pending');
    expect(hasReachedThreshold(current, 1)).toBe(true);
    expect(hasReachedThreshold(current)).toBe(false);
  });

  it('returns every collected share at once when the threshold is met', async () => {
    mockFetch({
      status: 200,
      body: {
        data: session({
          status: 'shares_collected',
          shares: [
            { re_encrypted_share: 'a', submitted_at: '2026-07-26T12:05:00Z' },
            { re_encrypted_share: 'b', submitted_at: '2026-07-26T12:07:00Z' },
          ],
        }),
      },
    });

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
    expect(
      isSessionExpired(session({ expires_at: new Date(Date.now() - 1000).toISOString() })),
    ).toBe(true);
    expect(isSessionExpired(session())).toBe(false);
  });

  it('polls until the threshold is reached, reporting each update', async () => {
    mockFetch(
      { status: 200, body: { data: session() } },
      { status: 200, body: { data: session() } },
      {
        status: 200,
        body: {
          data: session({
            status: 'shares_collected',
            shares: [
              { re_encrypted_share: 'a', submitted_at: 'x' },
              { re_encrypted_share: 'b', submitted_at: 'y' },
            ],
          }),
        },
      },
    );

    const seen: string[] = [];
    const result = await pollRecoverySession(SESSION_ID, {
      intervalMs: 1,
      onUpdate: (s) => seen.push(s.status),
    });

    expect(seen).toEqual(['pending', 'pending', 'shares_collected']);
    expect(result.status).toBe('shares_collected');
  });

  it('stops polling one guardian earlier when the Recovery Kit is held', async () => {
    mockFetch(
      { status: 200, body: { data: session() } },
      {
        status: 200,
        body: {
          data: session({ shares: [{ re_encrypted_share: 'a', submitted_at: 'x' }] }),
        },
      },
    );

    const seen: string[] = [];
    const result = await pollRecoverySession(SESSION_ID, {
      intervalMs: 1,
      ownShareCount: 1,
      onUpdate: (s) => seen.push(s.status),
    });

    expect(seen).toEqual(['pending', 'pending']);
    expect(result.shares).toHaveLength(1);
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
      body: { data: { encrypted_seed: 'blob', n_shares: 3, k_threshold: 2, version: 'v1' } },
    });

    const vault = await getRecoveryVault('alice1234abcd');
    expect(calls[0].url).toBe(
      'http://localhost:8080/recovery/vault?username=alice1234abcd',
    );
    expect(vault.k_threshold).toBe(2);
  });
});

describe('the whole recovery, end to end through real PQXDH', () => {
  async function scenario(threshold: number, guardianIndices: number[]) {
    const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, {
      shares: 3,
      threshold,
    });
    const keys = generateEphemeralKeys();
    const fields = ephemeralPublicFields(keys);

    const collected = await Promise.all(
      guardianIndices.map(async (index) => ({
        re_encrypted_share: await rewrapToSession(shares[index].bytes, fields, SESSION_ID),
        submitted_at: 'x',
      })),
    );

    return { encryptedSeed, shares, keys, collected };
  }

  it('rebuilds the phrase from two guardian shares', async () => {
    const { encryptedSeed, keys, collected } = await scenario(2, [1, 2]);

    expect(
      await completeRecovery({
        session: session({ status: 'shares_collected', shares: collected }),
        keys,
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 2, version: 'v1' },
      }),
    ).toBe(mnemonic);
  });

  it('rebuilds from one guardian plus the Recovery Kit share', async () => {
    const { encryptedSeed, shares, keys, collected } = await scenario(2, [1]);

    expect(
      await completeRecovery({
        session: session({ status: 'shares_collected', shares: collected }),
        keys,
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 2, version: 'v1' },
        ownShare: shares[0].bytes,
      }),
    ).toBe(mnemonic);
  });

  it('refuses before the threshold is met', async () => {
    const { encryptedSeed, keys } = await scenario(2, []);

    await expect(
      completeRecovery({
        session: session(),
        keys,
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 2, version: 'v1' },
      }),
    ).rejects.toThrow(/threshold/);
  });

  it('refuses when fewer shares than k are in hand', async () => {
    const { encryptedSeed, keys, collected } = await scenario(3, [1]);

    await expect(
      completeRecovery({
        session: session({ k_threshold: 3, status: 'shares_collected', shares: collected }),
        keys,
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 3, version: 'v1' },
        ownShare: undefined,
      }),
    ).rejects.toThrow(/threshold/);
  });

  it("trusts the vault's k over the session's when the two disagree", async () => {
    const { encryptedSeed, keys, collected } = await scenario(3, [1]);

    await expect(
      completeRecovery({
        session: session({ k_threshold: 1, status: 'shares_collected', shares: collected }),
        keys,
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 3, version: 'v1' },
      }),
    ).rejects.toThrow(/need 3/);
  });

  it('fails loudly if a share was wrapped for a different session', async () => {
    const { encryptedSeed, shares, keys } = await scenario(2, []);
    const wrongSession = await rewrapToSession(
      shares[1].bytes,
      ephemeralPublicFields(keys),
      OTHER_SESSION_ID,
    );

    await expect(
      completeRecovery({
        session: session({
          status: 'shares_collected',
          shares: [{ re_encrypted_share: wrongSession, submitted_at: 'x' }],
        }),
        keys,
        vault: { encrypted_seed: encryptedSeed, n_shares: 3, k_threshold: 2, version: 'v1' },
        ownShare: shares[0].bytes,
      }),
    ).rejects.toThrow();
  });
});
