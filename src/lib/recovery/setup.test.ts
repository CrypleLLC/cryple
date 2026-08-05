import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { pqxdhUnwrap } from '@/lib/pqxdh';
import type { AuthedContext } from '@/lib/context';
import {
  buildSetupPayload,
  canonicalSetupString,
  combineSecret,
  recoverSeedPhrase,
  setupDigest,
  RecoveryValidationError,
  SetupValidationError,
  submitRecoverySetup,
  validateSetupPayload,
  type GuardianRecipient,
  type SetupPayload,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const ownerAddress = vectors.seed_and_user_address.user_address;
const pin = vectors.server_auth_token.pin;

const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;

const CIPHERTEXT = 'cGxhY2Vob2xkZXItY2lwaGVydGV4dA==';

/** Mirrors the backend's setupInput/ownShare/guardianShare helpers. */
function ownShare() {
  return { share_index: 0, pq_hybrid_encrypted_share: CIPHERTEXT };
}
function guardianShare(index: number, username: string) {
  return {
    share_index: index,
    guardian_username: username,
    pq_hybrid_encrypted_share: CIPHERTEXT,
  };
}
function setupInput(...shares: SetupPayload['shares']): SetupPayload {
  return {
    encrypted_seed: 'YmFzZTY0LWVuY3J5cHRlZC1zZWVk',
    n_shares: shares.length,
    k_threshold: shares.length,
    shares,
  };
}

describe('the canonical string is built exactly as the backend builds it', () => {
  it('joins the four header fields and each share with the documented separators', () => {
    const payload = setupInput(ownShare(), guardianShare(1, 'alice'));
    expect(canonicalSetupString(payload)).toBe(
      `YmFzZTY0LWVuY3J5cHRlZC1zZWVk|2|2||0::${CIPHERTEXT}|1:alice:${CIPHERTEXT}`,
    );
  });

  it('leaves share 0 middle field empty — it has no guardian', () => {
    expect(canonicalSetupString(setupInput(ownShare()))).toContain(`|0::${CIPHERTEXT}`);
  });

  it('uses the literal version string sent — empty when omitted', () => {
    const omitted = setupInput(ownShare());
    const explicit = { ...setupInput(ownShare()), version: 'v1' };

    expect(canonicalSetupString(omitted).split('|')[3]).toBe('');
    expect(canonicalSetupString(explicit).split('|')[3]).toBe('v1');
  });

  it('signs what it sends — an omitted version is not pre-normalized to v1', async () => {
    const omitted = setupInput(ownShare());
    const normalized = { ...omitted, version: 'v1' };
    expect(await setupDigest(omitted)).not.toBe(await setupDigest(normalized));
  });

  it('produces a lowercase hex SHA-256', async () => {
    expect(await setupDigest(setupInput(ownShare()))).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Ported from TestSetupDigest_IsIndependentOfShareOrder
describe('SetupDigest is independent of share order', () => {
  it('matches whatever order the client happened to build the array in', async () => {
    const ordered = setupInput(ownShare(), guardianShare(1, 'alice'), guardianShare(2, 'bob'));
    const shuffled = setupInput(guardianShare(2, 'bob'), ownShare(), guardianShare(1, 'alice'));

    expect(await setupDigest(ordered)).toBe(await setupDigest(shuffled));
  });

  it('holds for a reversed array too', async () => {
    const forward = setupInput(ownShare(), guardianShare(1, 'a'), guardianShare(2, 'b'));
    const backward = setupInput(...[...forward.shares].reverse());

    expect(await setupDigest(forward)).toBe(await setupDigest(backward));
  });

  it('does not mutate the caller’s array while sorting', () => {
    const payload = setupInput(guardianShare(2, 'bob'), ownShare(), guardianShare(1, 'alice'));
    canonicalSetupString(payload);
    expect(payload.shares.map((s) => s.share_index)).toEqual([2, 0, 1]);
  });
});

// Ported from TestSetupDigest_ChangesWithEveryFieldItCommitsTo
describe('SetupDigest changes with every field it commits to', () => {
  const base = setupInput(ownShare(), guardianShare(1, 'alice'));

  const mutations: Record<string, (payload: SetupPayload) => void> = {
    'a substituted seed': (p) => void (p.encrypted_seed = 'different'),
    'a substituted share': (p) => void (p.shares[1].pq_hybrid_encrypted_share = 'swapped'),
    'a substituted guardian': (p) => void (p.shares[1].guardian_username = 'attacker'),
    'a lowered threshold': (p) => void (p.k_threshold = 1),
    'a different share count': (p) => void (p.n_shares = 3),
    'a downgraded version': (p) => void (p.version = 'v0'),
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    it(`differs after ${name}`, async () => {
      const tampered = setupInput(ownShare(), guardianShare(1, 'alice'));
      mutate(tampered);
      expect(await setupDigest(tampered)).not.toBe(await setupDigest(base));
    });
  }

  it('also differs when a share index moves', async () => {
    const moved = setupInput(ownShare(), guardianShare(1, 'alice'));
    moved.shares[1].share_index = 5;
    expect(await setupDigest(moved)).not.toBe(await setupDigest(base));
  });
});

describe('local validation mirrors the server rules', () => {
  it('accepts a well-formed 2-of-3', () => {
    const payload: SetupPayload = {
      encrypted_seed: 'seed',
      n_shares: 3,
      k_threshold: 2,
      shares: [ownShare(), guardianShare(1, 'alice'), guardianShare(2, 'bob')],
    };
    expect(() => validateSetupPayload(payload)).not.toThrow();
  });

  it('requires shares.length to equal n_shares', () => {
    const payload = { ...setupInput(ownShare()), n_shares: 2 };
    expect(() => validateSetupPayload(payload)).toThrow(/must equal n_shares/);
  });

  it('requires share 0', () => {
    const payload: SetupPayload = {
      encrypted_seed: 'seed',
      n_shares: 1,
      k_threshold: 1,
      shares: [guardianShare(0, 'alice')],
    };
    expect(() => validateSetupPayload(payload)).toThrow(/takes no guardian/);
  });

  it('refuses a guardian on share 0', () => {
    const payload = setupInput({ ...ownShare(), guardian_username: 'alice' });
    expect(() => validateSetupPayload(payload)).toThrow(/takes no guardian/);
  });

  it('requires a guardian on every index >= 1', () => {
    const payload = setupInput(ownShare(), {
      share_index: 1,
      pq_hybrid_encrypted_share: CIPHERTEXT,
    });
    expect(() => validateSetupPayload(payload)).toThrow(/needs a guardian_username/);
  });

  it('refuses a duplicate share index', () => {
    const payload = setupInput(ownShare(), guardianShare(0, 'alice'));
    expect(() => validateSetupPayload(payload)).toThrow(/takes no guardian|duplicate/);
  });

  it('refuses one guardian holding two shares', () => {
    const payload = setupInput(ownShare(), guardianShare(1, 'alice'), guardianShare(2, 'alice'));
    expect(() => validateSetupPayload(payload)).toThrow(/more than one share/);
  });

  it('refuses an empty ciphertext', () => {
    const payload = setupInput({ share_index: 0, pq_hybrid_encrypted_share: '' });
    expect(() => validateSetupPayload(payload)).toThrow(/no ciphertext/);
  });

  it('refuses an index outside the range', () => {
    const payload = setupInput(ownShare(), guardianShare(7, 'alice'));
    expect(() => validateSetupPayload(payload)).toThrow(/outside 0\.\./);
  });

  it('refuses an unsupported version', () => {
    const payload = { ...setupInput(ownShare()), version: 'v2' };
    expect(() => validateSetupPayload(payload)).toThrow(/version must be/);
  });

  it('refuses k greater than n', () => {
    const payload = { ...setupInput(ownShare()), k_threshold: 4 };
    expect(() => validateSetupPayload(payload)).toThrow(RecoveryValidationError);
  });
});

describe('building the payload end to end', () => {
  function guardian(name: string, address: string): GuardianRecipient {
    return {
      username: name,
      userAddress: address,
      x25519PublicKey: tree.x25519.publicKey,
      mlkemPublicKey: tree.mlkem768.publicKey,
    };
  }

  const options = {
    seedPhrase: mnemonic,
    ownerUserAddress: ownerAddress,
    ownerX25519PublicKey: tree.x25519.publicKey,
    ownerMlkemPublicKey: tree.mlkem768.publicKey,
    guardians: [guardian('alice', 'a'.repeat(64)), guardian('bob', 'b'.repeat(64))],
    threshold: 2,
  };

  it('produces n = guardians + 1 shares with index 0 reserved for the owner', async () => {
    const { payload } = await buildSetupPayload(options);

    expect(payload.n_shares).toBe(3);
    expect(payload.k_threshold).toBe(2);
    expect(payload.shares.map((s) => s.share_index)).toEqual([0, 1, 2]);
    expect(payload.shares[0].guardian_username).toBeUndefined();
    expect(payload.shares[1].guardian_username).toBe('alice');
  });

  it('wraps every share with PQXDH so nothing plaintext is sent', async () => {
    const { payload } = await buildSetupPayload(options);
    for (const share of payload.shares) {
      expect(atob(share.pq_hybrid_encrypted_share)).toHaveLength(1181 - 32 + 33);
    }
  });

  it('wraps share 0 to the owner’s own keys, per recovery-flow.md', async () => {
    const { payload, recoveryKitShare } = await buildSetupPayload(options);

    const unwrapped = await pqxdhUnwrap(
      payload.shares[0].pq_hybrid_encrypted_share,
      { x25519PrivateKey: tree.x25519.privateKey, mlkemSecretKey: tree.mlkem768.secretKey },
      {
        usage: 'recovery-share',
        senderUserAddress: ownerAddress,
        recipientUserAddress: ownerAddress,
      },
    );

    expect([...unwrapped]).toEqual([...recoveryKitShare]);
  });

  it('returns the Recovery Kit share so the UI can render it offline', async () => {
    const { recoveryKitShare } = await buildSetupPayload(options);
    expect(recoveryKitShare).toHaveLength(33);
  });

  it('round-trips: the kit share plus one guardian share rebuilds the phrase', async () => {
    const { payload, recoveryKitShare } = await buildSetupPayload(options);

    const guardianShareBytes = await pqxdhUnwrap(
      payload.shares[1].pq_hybrid_encrypted_share,
      { x25519PrivateKey: tree.x25519.privateKey, mlkemSecretKey: tree.mlkem768.secretKey },
      {
        usage: 'recovery-share',
        senderUserAddress: ownerAddress,
        recipientUserAddress: 'a'.repeat(64),
      },
    );

    const rek = await combineSecret([recoveryKitShare, guardianShareBytes]);
    expect(rek).toHaveLength(32);
    expect(await recoverSeedPhrase(payload.encrypted_seed, [
      recoveryKitShare,
      guardianShareBytes,
    ])).toBe(mnemonic);
  });

  it('omits version by default so the digest commits to the empty string', async () => {
    const { payload } = await buildSetupPayload(options);
    expect(payload.version).toBeUndefined();
    expect(canonicalSetupString(payload).split('|')[3]).toBe('');
  });

  it('refuses a threshold above the share count before generating anything', async () => {
    await expect(buildSetupPayload({ ...options, threshold: 9 })).rejects.toThrow();
  });
});

describe('PUT /recovery/setup', () => {
  function mockFetch(spec: { status: number; body?: unknown }) {
    const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          method: init.method as string,
          url,
          body: JSON.parse(init.body as string),
        });
        return {
          status: spec.status,
          ok: true,
          text: async () => JSON.stringify(spec.body),
          headers: { get: () => null },
        } as unknown as Response;
      }),
    );
    return calls;
  }

  async function newContext(): Promise<AuthedContext> {
    const session = new SessionKeystore({ idleTimeoutMs: 0 });
    await session.unlockWithMnemonic(mnemonic, pin);
    const tokens = new TokenStore();
    tokens.set('jwt-token');
    return { session, tokens, paranoid: true };
  }

  afterEach(() => vi.unstubAllGlobals());

  const stored = {
    status: 200,
    body: {
      message: 'Recovery setup stored successfully',
      data: {
        n_shares: 2,
        k_threshold: 2,
        version: 'v1',
        share_count: 2,
        updated_at: '2026-07-26T12:00:00Z',
      },
    },
  };

  it('PUTs the payload and signs the digest of exactly what it sends', async () => {
    const calls = mockFetch(stored);
    const payload = setupInput(ownShare(), guardianShare(1, 'alice'));

    await submitRecoverySetup(await newContext(), payload);

    const body = calls[0].body;
    expect(calls[0].method).toBe('PUT');

    const digest = await setupDigest(payload);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'recovery-setup',
          [digest],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('sends the signed payload verbatim alongside the envelope', async () => {
    const calls = mockFetch(stored);
    const payload = setupInput(ownShare(), guardianShare(1, 'alice'));

    await submitRecoverySetup(await newContext(), payload);

    const body = calls[0].body;
    expect(body.encrypted_seed).toBe(payload.encrypted_seed);
    expect(body.n_shares).toBe(2);
    expect(body.shares).toEqual(payload.shares);
    expect(body).not.toHaveProperty('version');
  });

  it('attaches the second factor — setup replaces the whole configuration', async () => {
    const calls = mockFetch(stored);
    await submitRecoverySetup(await newContext(), setupInput(ownShare()));
    expect(calls[0].body).toHaveProperty('password');
  });

  it('reads the 200 result body', async () => {
    mockFetch(stored);
    const result = await submitRecoverySetup(await newContext(), setupInput(ownShare()));
    expect(result.share_count).toBe(2);
    expect(result.version).toBe('v1');
  });

  it('refuses to send an invalid payload at all', async () => {
    mockFetch(stored);
    const broken = { ...setupInput(ownShare()), n_shares: 5 };
    await expect(submitRecoverySetup(await newContext(), broken)).rejects.toThrow(
      SetupValidationError,
    );
  });
});
