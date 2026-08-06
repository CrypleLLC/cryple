import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveServerAuthToken } from '@/lib/pin';
import { buildActionPayload, signPayload, verifyPayload } from '@/lib/signing';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import type { AuthedContext } from '@/lib/context';
import {
  canVoteOn,
  confirmPinReset,
  contestPeriodRemainingMs,
  getPinResetStatus,
  listPendingPinResets,
  listPinResetVotes,
  requestPinReset,
  revokePinReset,
  verifyPinResetVotes,
  voteOnPinReset,
  type PendingPinReset,
  type PinResetVote,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const userAddress = vectors.seed_and_user_address.user_address;
const pin = vectors.server_auth_token.pin;
const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;
const spki = vectors.identity_key_p256.public_key_spki_base64;

const REQUEST_ID = 'b8e2f1a3-4f89-11d3-9a0c-0305e82c3301';
const NEW_PIN = '719284';

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

async function newSession() {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  return session;
}

async function newContext(paranoid = true): Promise<AuthedContext> {
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session: await newSession(), tokens, paranoid };
}

const openRequest = {
  status: 201,
  body: {
    data: {
      id: REQUEST_ID,
      status: 'pending_quorum',
      votes: 0,
      required_votes: 2,
      created_at: '2026-07-26T12:00:00Z',
    },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('the owner’s three actions never carry a second factor', () => {
  it('omits password on request, even for a Paranoid account', async () => {
    const calls = mockFetch(openRequest);
    await requestPinReset(await newSession());

    expect(calls[0].body).not.toHaveProperty('password');
    expect(calls[0].body!.user_address).toBe(userAddress);
  });

  it('omits password on revoke', async () => {
    const calls = mockFetch({ status: 204 });
    await revokePinReset(await newSession(), REQUEST_ID);
    expect(calls[0].body).not.toHaveProperty('password');
  });

  it('omits password on confirm', async () => {
    const calls = mockFetch({ status: 204 });
    await confirmPinReset(await newSession(), REQUEST_ID, NEW_PIN);
    expect(calls[0].body).not.toHaveProperty('password');
  });

  it('sends no Authorization header — these routes are public', async () => {
    mockFetch(openRequest);
    const calls = mockFetch(openRequest);
    await requestPinReset(await newSession());
    expect(calls[0].body).toBeDefined();
  });
});

describe('opening a request', () => {
  it('signs the owner’s user_address', async () => {
    const calls = mockFetch(openRequest);
    await requestPinReset(await newSession());

    const body = calls[0].body!;
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'pin-reset-request',
          [userAddress],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('distinguishes a new request (201) from one already open (200)', async () => {
    mockFetch(openRequest);
    expect((await requestPinReset(await newSession())).created).toBe(true);

    mockFetch({ ...openRequest, status: 200 });
    const existing = await requestPinReset(await newSession());
    expect(existing.created).toBe(false);
    expect(existing.request.votes).toBe(0);
  });
});

describe('revoke and confirm', () => {
  it('binds revoke to the request id', async () => {
    const calls = mockFetch({ status: 204 });
    await revokePinReset(await newSession(), REQUEST_ID);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('PATCH');
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'pin-reset-revoke',
          [REQUEST_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('signs the NEW token on confirm, not merely the intent', async () => {
    const calls = mockFetch({ status: 204 });
    await confirmPinReset(await newSession(), REQUEST_ID, NEW_PIN);

    const body = calls[0].body!;
    const newToken = await deriveServerAuthToken(NEW_PIN, userAddress);

    expect(body.new_password).toBe(newToken);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'pin-reset-confirm',
          [REQUEST_ID, newToken],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('installs the new token in the session afterwards', async () => {
    mockFetch({ status: 204 });
    const session = await newSession();
    await confirmPinReset(session, REQUEST_ID, NEW_PIN);

    expect(session.serverAuthToken()).toBe(await deriveServerAuthToken(NEW_PIN, userAddress));
  });

  it('refuses a non-canonical request id before sending', async () => {
    mockFetch({ status: 204 });
    await expect(
      revokePinReset(await newSession(), REQUEST_ID.toUpperCase()),
    ).rejects.toThrow(/canonical/);
  });
});

describe('the guardian side', () => {
  const pendingRows: PendingPinReset[] = [
    {
      request_id: REQUEST_ID,
      owner_username: '3f1c8a2b9d4e',
      status: 'pending_quorum',
      voted: false,
      created_at: '2026-07-26T12:00:00Z',
    },
    {
      request_id: '9c4f2a1b-4f89-11d3-9a0c-0305e82c3301',
      owner_username: '7a2d5e1b8c3f',
      status: 'contest_period',
      voted: true,
      created_at: '2026-07-25T08:00:00Z',
    },
    {
      request_id: '1a2b3c4d-4f89-11d3-9a0c-0305e82c3301',
      owner_username: 'aaaa1111bbbb',
      status: 'pending_quorum',
      voted: true,
      created_at: '2026-07-25T08:00:00Z',
    },
  ];

  it('lists the inbox across pages', async () => {
    mockFetch({ status: 200, body: { data: pendingRows, page: { has_more: false } } });
    expect(await listPendingPinResets(await newContext())).toHaveLength(3);
  });

  it('gates the vote affordance on pending_quorum AND not already voted', () => {
    expect(canVoteOn(pendingRows[0])).toBe(true);
    expect(canVoteOn(pendingRows[1])).toBe(false);
    expect(canVoteOn(pendingRows[2])).toBe(false);
  });

  it('uses the guardian’s own second factor when voting', async () => {
    const calls = mockFetch({
      status: 200,
      body: { data: { ...openRequest.body.data, status: 'contest_period', votes: 2 } },
    });

    await voteOnPinReset(await newContext(true), REQUEST_ID, 'alice1234abcd');
    expect(calls[0].body).toHaveProperty('password');
    expect(calls[0].body!.guardian_username).toBe('alice1234abcd');
  });

  it('omits the token for a Standard-mode guardian', async () => {
    const calls = mockFetch({ status: 200, body: { data: openRequest.body.data } });
    await voteOnPinReset(await newContext(false), REQUEST_ID, 'alice1234abcd');
    expect(calls[0].body).not.toHaveProperty('password');
  });

  it('binds the vote to the request id', async () => {
    const calls = mockFetch({ status: 200, body: { data: openRequest.body.data } });
    await voteOnPinReset(await newContext(), REQUEST_ID, 'alice1234abcd');

    const body = calls[0].body!;
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'pin-reset-vote',
          [REQUEST_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });
});

describe('auditing votes client-side', () => {
  function signedVote(requestId: string, overrides: Partial<PinResetVote> = {}): PinResetVote {
    const challenge = 'a'.repeat(64);
    const timestamp = 1785345646;
    const payload = buildActionPayload(challenge, timestamp, 'pin-reset-vote', [requestId]);

    return {
      guardian_username: '5bdf04be3bc6',
      guardian_public_key: spki,
      signature: signPayload(payload, tree.identity.privateKey),
      challenge,
      timestamp,
      voted_at: '2026-07-29T17:20:46Z',
      ...overrides,
    };
  }

  it('verifies a genuine vote by rebuilding the payload from semantic fields', () => {
    const [checked] = verifyPinResetVotes(REQUEST_ID, [signedVote(REQUEST_ID)]);
    expect(checked.valid).toBe(true);
  });

  it('rejects a vote re-attributed to a different request', () => {
    const other = '9c4f2a1b-4f89-11d3-9a0c-0305e82c3301';
    const [checked] = verifyPinResetVotes(other, [signedVote(REQUEST_ID)]);
    expect(checked.valid).toBe(false);
  });

  it('rejects a tampered timestamp', () => {
    const vote = signedVote(REQUEST_ID);
    const [checked] = verifyPinResetVotes(REQUEST_ID, [{ ...vote, timestamp: 1785345647 }]);
    expect(checked.valid).toBe(false);
  });

  it('rejects a tampered challenge', () => {
    const vote = signedVote(REQUEST_ID);
    const [checked] = verifyPinResetVotes(REQUEST_ID, [{ ...vote, challenge: 'b'.repeat(64) }]);
    expect(checked.valid).toBe(false);
  });

  it('rejects a fabricated vote attributed to another key', () => {
    const vote = signedVote(REQUEST_ID);
    const [checked] = verifyPinResetVotes(REQUEST_ID, [
      { ...vote, signature: signPayload('unrelated', tree.identity.privateKey) },
    ]);
    expect(checked.valid).toBe(false);
  });

  it('never throws on a malformed public key — it reports invalid', () => {
    const vote = signedVote(REQUEST_ID);
    const [checked] = verifyPinResetVotes(REQUEST_ID, [
      { ...vote, guardian_public_key: 'not-a-key' },
    ]);
    expect(checked.valid).toBe(false);
  });

  it('reads the report and audits every row', async () => {
    mockFetch({
      status: 200,
      body: {
        data: {
          action: 'pin-reset-vote',
          request_id: REQUEST_ID,
          votes: [signedVote(REQUEST_ID), signedVote(REQUEST_ID)],
        },
      },
    });

    const report = await listPinResetVotes(await newContext(), REQUEST_ID);
    expect(report.votes).toHaveLength(2);
    expect(verifyPinResetVotes(report.request_id, report.votes).every((v) => v.valid)).toBe(
      true,
    );
  });
});

describe('the contest period', () => {
  it('reports remaining time while it is open', () => {
    const ends = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const remaining = contestPeriodRemainingMs({
      id: REQUEST_ID,
      status: 'contest_period',
      votes: 2,
      required_votes: 2,
      contest_period_ends_at: ends,
      created_at: 'x',
    });

    expect(remaining).toBeGreaterThan(47 * 3600 * 1000);
  });

  it('clamps to zero once elapsed', () => {
    expect(
      contestPeriodRemainingMs({
        id: REQUEST_ID,
        status: 'contest_period',
        votes: 2,
        required_votes: 2,
        contest_period_ends_at: new Date(Date.now() - 1000).toISOString(),
        created_at: 'x',
      }),
    ).toBe(0);
  });

  it('is absent before quorum', () => {
    expect(
      contestPeriodRemainingMs({
        id: REQUEST_ID,
        status: 'pending_quorum',
        votes: 0,
        required_votes: 2,
        created_at: 'x',
      }),
    ).toBeUndefined();
  });

  it('settles on read — polling status is what flips contest_period to authorized', async () => {
    mockFetch({
      status: 200,
      body: { data: { ...openRequest.body.data, status: 'authorized', votes: 2 } },
    });
    expect((await getPinResetStatus(REQUEST_ID)).status).toBe('authorized');
  });
});
