import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import { buildActionPayload, createChallenge, currentTimestamp, signPayload, verifyPayload } from '@/lib/signing';
import type { AuthedContext } from '@/lib/context';
import type { Guardianship } from '@/lib/recovery';
import {
  castReleaseVote,
  countdownStartedAt,
  getReleaseStatus,
  GuardianshipNotVotableError,
  isCountingDown,
  listReleaseVotes,
  toVotableOwner,
  verifyReleaseVotes,
  verifyReport,
  type ReleaseStatusRecord,
  type ReleaseVote,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;
const spkiPublicKey = vectors.identity_key_p256.public_key_spki_base64;

const OWNER_ADDRESS = 'a'.repeat(64);
const GUARDIANSHIP_ID = '9c1e5f2a-4f89-11d3-9a0c-0305e82c3301';

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

async function newContext(paranoid = true): Promise<AuthedContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid };
}

function guardianship(overrides: Partial<Guardianship> = {}): Guardianship {
  return {
    id: GUARDIANSHIP_ID,
    owner_username: '3f1c8a2b9d4e',
    owner_user_address: OWNER_ADDRESS,
    owner_release_cycle: 3,
    status: 'active',
    created_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function status(overrides: Partial<ReleaseStatusRecord> = {}): ReleaseStatusRecord {
  return {
    status: 'monitoring',
    votes: 0,
    required_votes: 1,
    release_cycle: 1,
    inactivity_threshold_days: 180,
    last_check_in: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function signedVote(cycle: number, ownerAddress = OWNER_ADDRESS): ReleaseVote {
  const challenge = createChallenge();
  const timestamp = currentTimestamp();
  const payload = buildActionPayload(challenge, timestamp, 'succession-release-vote', [
    ownerAddress,
    cycle,
  ]);

  return {
    guardian_username: '5bdf04be3bc6',
    guardian_public_key: spkiPublicKey,
    release_cycle: cycle,
    signature: signPayload(payload, tree.identity.privateKey),
    challenge,
    timestamp,
    voted_at: '2026-07-29T17:20:46Z',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('casting a release vote reads the cycle from the guardianship row', () => {
  it('reads owner_release_cycle immediately before signing, not from the owner-scoped status', async () => {
    const calls = mockFetch(
      { status: 200, body: { data: [guardianship()], page: { has_more: false } } },
      { status: 200, body: { data: status({ status: 'counting_down', votes: 1 }) } },
    );

    await castReleaseVote(await newContext(), '3f1c8a2b9d4e');

    expect(calls[0].url).toContain('/recovery/guardianships');
    expect(calls[1].url).toContain('/succession/votes');
    expect(calls.some((call) => call.url.includes('/succession/status'))).toBe(false);
  });

  it('binds the owner address and the cycle, in that order', async () => {
    const calls = mockFetch(
      { status: 200, body: { data: [guardianship()], page: { has_more: false } } },
      { status: 200, body: { data: status() } },
    );

    await castReleaseVote(await newContext(), '3f1c8a2b9d4e');

    const body = calls[1].body!;
    expect(body.owner_username).toBe('3f1c8a2b9d4e');
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'succession-release-vote',
          [OWNER_ADDRESS, 3],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('a cycle-3 signature does not verify as cycle 4', async () => {
    const calls = mockFetch(
      { status: 200, body: { data: [guardianship()], page: { has_more: false } } },
      { status: 200, body: { data: status() } },
    );

    await castReleaseVote(await newContext(), '3f1c8a2b9d4e');

    const body = calls[1].body!;
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'succession-release-vote',
          [OWNER_ADDRESS, 4],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(false);
  });

  it('carries the guardian’s own second factor, not the owner’s', async () => {
    const paranoid = mockFetch(
      { status: 200, body: { data: [guardianship()], page: { has_more: false } } },
      { status: 200, body: { data: status() } },
    );
    await castReleaseVote(await newContext(true), '3f1c8a2b9d4e');
    expect(paranoid[1].body).toHaveProperty('password');

    vi.unstubAllGlobals();
    const standard = mockFetch(
      { status: 200, body: { data: [guardianship()], page: { has_more: false } } },
      { status: 200, body: { data: status() } },
    );
    await castReleaseVote(await newContext(false), '3f1c8a2b9d4e');
    expect(standard[1].body).not.toHaveProperty('password');
  });

  it('refuses when the caller does not guard that account', async () => {
    mockFetch({ status: 200, body: { data: [], page: { has_more: false } } });

    await expect(castReleaseVote(await newContext(), '3f1c8a2b9d4e')).rejects.toThrow(
      GuardianshipNotVotableError,
    );
  });

  it('refuses a pending_invite row — both signed values are absent on it', () => {
    const pending: Guardianship = {
      id: GUARDIANSHIP_ID,
      owner_username: '3f1c8a2b9d4e',
      status: 'pending_invite',
      created_at: '2026-07-26T12:00:00Z',
    };

    expect(() => toVotableOwner(pending)).toThrow(GuardianshipNotVotableError);
  });

  it('refuses an active row missing owner_release_cycle rather than guessing a cycle', () => {
    expect(() => toVotableOwner(guardianship({ owner_release_cycle: undefined }))).toThrow(
      /owner_release_cycle/,
    );
  });

  it('refuses an active row missing owner_user_address', () => {
    expect(() => toVotableOwner(guardianship({ owner_user_address: undefined }))).toThrow(
      /owner_user_address/,
    );
  });
});

describe('the owner’s own switch status', () => {
  it('reads the two reachable states', async () => {
    mockFetch({ status: 200, body: { data: status({ status: 'counting_down' }) } });

    const record = await getReleaseStatus(await newContext());
    expect(isCountingDown(record)).toBe(true);
  });

  it('treats trigger_started_at as absent, never as null', async () => {
    mockFetch({ status: 200, body: { data: status() } });

    const record = await getReleaseStatus(await newContext());
    expect(record.trigger_started_at).toBeUndefined();
    expect('trigger_started_at' in record).toBe(false);
    expect(countdownStartedAt(record)).toBeUndefined();
  });

  it('parses trigger_started_at once a countdown starts', async () => {
    mockFetch({
      status: 200,
      body: {
        data: status({ status: 'counting_down', trigger_started_at: '2026-07-26T12:00:00Z' }),
      },
    });

    const record = await getReleaseStatus(await newContext());
    expect(countdownStartedAt(record)?.toISOString()).toBe('2026-07-26T12:00:00.000Z');
  });
});

describe('auditing the votes behind the count', () => {
  it('follows pagination over the nested votes array and keeps the envelope fields', async () => {
    const first = signedVote(1);
    const second = signedVote(1);

    mockFetch(
      {
        status: 200,
        body: {
          data: {
            action: 'succession-release-vote',
            owner_user_address: OWNER_ADDRESS,
            release_cycle: 1,
            votes: [first],
          },
          page: { next_cursor: 'c1', has_more: true },
        },
      },
      {
        status: 200,
        body: {
          data: {
            action: 'succession-release-vote',
            owner_user_address: OWNER_ADDRESS,
            release_cycle: 1,
            votes: [second],
          },
          page: { has_more: false },
        },
      },
    );

    const report = await listReleaseVotes(await newContext());
    expect(report.votes).toHaveLength(2);
    expect(report.owner_user_address).toBe(OWNER_ADDRESS);
    expect(report.release_cycle).toBe(1);
  });

  it('verifies a genuine vote by rebuilding the payload from the labelled fields', () => {
    const verified = verifyReleaseVotes(OWNER_ADDRESS, 1, [signedVote(1)]);
    expect(verified[0].valid).toBe(true);
  });

  it('rejects a vote whose signature was made for a different cycle', () => {
    const vote = signedVote(2);
    const relabelled: ReleaseVote = { ...vote, release_cycle: 1 };

    expect(verifyReleaseVotes(OWNER_ADDRESS, 1, [relabelled])[0].valid).toBe(false);
  });

  it('rejects a vote made against a different owner', () => {
    const vote = signedVote(1, 'd'.repeat(64));
    expect(verifyReleaseVotes(OWNER_ADDRESS, 1, [vote])[0].valid).toBe(false);
  });

  it('rejects a tampered signature without throwing', () => {
    const vote = signedVote(1);
    const tampered: ReleaseVote = { ...vote, signature: 'not-base64-at-all!!' };

    expect(verifyReleaseVotes(OWNER_ADDRESS, 1, [tampered])[0].valid).toBe(false);
  });

  it('verifies a whole report against its own envelope fields', () => {
    const report = {
      action: 'succession-release-vote',
      owner_user_address: OWNER_ADDRESS,
      release_cycle: 1,
      votes: [signedVote(1), signedVote(1, 'e'.repeat(64))],
    };

    expect(verifyReport(report).map((entry) => entry.valid)).toEqual([true, false]);
  });
});
