import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { bytesToHex, hexToBytes } from '@/lib/encoding';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import type { AuthedContext } from '@/lib/context';
import {
  acceptGuardianship,
  activeGuardians,
  GuardianAddressUnavailableError,
  GuardianKeysUnavailableError,
  inviteGuardian,
  listGuardians,
  listGuardianships,
  pendingInvitations,
  recipientFor,
  revokeGuardian,
  summarizeQuorum,
  toRecipient,
  type Guardian,
  type Guardianship,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;

const GUARDIAN_ID = '9c1e5f2a-4f89-11d3-9a0c-0305e82c3301';
const GUARDIAN_ADDRESS = '2'.repeat(64);

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

function guardian(overrides: Partial<Guardian> = {}): Guardian {
  return {
    id: GUARDIAN_ID,
    username: 'alice1234abcd',
    user_address: GUARDIAN_ADDRESS,
    status: 'active',
    encryption_public_key_x25519: vectors.x25519_key.public_key_base64,
    encryption_public_key_mlkem: vectors.mlkem768_key.public_key_base64,
    has_share: true,
    created_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('inviting a guardian', () => {
  it('signs the username, so it cannot be swapped after the fact', async () => {
    const calls = mockFetch({ status: 201, body: { data: guardian({ status: 'pending_invite' }) } });

    await inviteGuardian(await newContext(), 'alice1234abcd');

    const body = calls[0].body!;
    expect(body.guardian_username).toBe('alice1234abcd');
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'guardian-invite',
          ['alice1234abcd'],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('will not verify against a different username', async () => {
    const calls = mockFetch({ status: 201, body: { data: guardian() } });
    await inviteGuardian(await newContext(), 'alice1234abcd');

    const body = calls[0].body!;
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'guardian-invite',
          ['attacker9999'],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(false);
  });

  it('carries the second factor — a guardian set change needs the seed key plus the PIN', async () => {
    const calls = mockFetch({ status: 201, body: { data: guardian() } });
    await inviteGuardian(await newContext(true), 'alice1234abcd');
    expect(calls[0].body).toHaveProperty('password');
  });

  it('signs twice for two guardians — signatures are single-use and bind one target', async () => {
    const calls = mockFetch({ status: 201, body: { data: guardian() } });
    const context = await newContext();

    await inviteGuardian(context, 'alice1234abcd');
    await inviteGuardian(context, 'bob5678efgh');

    expect(calls[0].body!.challenge).not.toBe(calls[1].body!.challenge);
    expect(calls[0].body!.signature).not.toBe(calls[1].body!.signature);
  });
});

describe('accepting an invitation', () => {
  it('binds the invitation id — a bearer token cannot forge consent', async () => {
    const calls = mockFetch({ status: 204 });

    await acceptGuardianship(await newContext(), GUARDIAN_ID);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain(`/recovery/guardians/${GUARDIAN_ID}/accept`);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'guardian-accept',
          [GUARDIAN_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('sends the required body — it is no longer a bodyless PATCH', async () => {
    const calls = mockFetch({ status: 204 });
    await acceptGuardianship(await newContext(), GUARDIAN_ID);
    expect(calls[0].body).toBeDefined();
    expect(Object.keys(calls[0].body!).sort()).toEqual([
      'challenge',
      'password',
      'signature',
      'timestamp',
    ]);
  });

  it('uses the invitee’s own second factor, not the owner’s', async () => {
    const standard = mockFetch({ status: 204 });
    await acceptGuardianship(await newContext(false), GUARDIAN_ID);
    expect(standard[0].body).not.toHaveProperty('password');
  });

  it('refuses a non-canonical invitation id before sending', async () => {
    mockFetch({ status: 204 });
    await expect(
      acceptGuardianship(await newContext(), GUARDIAN_ID.toUpperCase()),
    ).rejects.toThrow(/canonical/);
  });
});

describe('revoking a guardian', () => {
  const revoked = {
    status: 200,
    body: {
      data: {
        id: GUARDIAN_ID,
        username: 'alice1234abcd',
        status: 'revoked',
        share_removed: true,
        votes_withdrawn: 1,
        active_guardians: 2,
        recovery_setup_stale: true,
      },
    },
  };

  it('sends the required body carrying the guardian-revoke signature', async () => {
    const calls = mockFetch(revoked);

    await revokeGuardian(await newContext(), GUARDIAN_ID);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('DELETE');
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'guardian-revoke',
          [GUARDIAN_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('reads the 200 body — this DELETE reports consequences the client must act on', async () => {
    mockFetch(revoked);
    const result = await revokeGuardian(await newContext(), GUARDIAN_ID);

    expect(result.share_removed).toBe(true);
    expect(result.votes_withdrawn).toBe(1);
    expect(result.recovery_setup_stale).toBe(true);
    expect(result.active_guardians).toBe(2);
  });

  it('surfaces the idempotent retry as success with nothing removed', async () => {
    mockFetch({
      status: 200,
      body: {
        data: {
          ...revoked.body.data,
          share_removed: false,
          votes_withdrawn: 0,
          recovery_setup_stale: false,
        },
      },
    });

    const result = await revokeGuardian(await newContext(), GUARDIAN_ID);
    expect(result.share_removed).toBe(false);
    expect(result.recovery_setup_stale).toBe(false);
  });
});

describe('listing', () => {
  it('follows pagination on guardians until has_more is false', async () => {
    mockFetch(
      {
        status: 200,
        body: {
          data: [guardian()],
          page: { next_cursor: 'c1', has_more: true },
        },
      },
      {
        status: 200,
        body: {
          data: [guardian({ id: '7b3d5e1c-4f89-11d3-9a0c-0305e82c3301' })],
          page: { has_more: false },
        },
      },
    );

    expect(await listGuardians(await newContext())).toHaveLength(2);
  });

  it('follows pagination on guardianships', async () => {
    mockFetch({ status: 200, body: { data: [], page: { has_more: false } } });
    expect(await listGuardianships(await newContext())).toEqual([]);
  });

  it('treats owner_user_address as absent on pending rows, never as empty string', () => {
    const rows: Guardianship[] = [
      {
        id: GUARDIAN_ID,
        owner_username: '3f1c8a2b9d4e',
        status: 'pending_invite',
        created_at: '2026-07-26T12:00:00Z',
      },
      {
        id: '7b3d5e1c-4f89-11d3-9a0c-0305e82c3301',
        owner_username: 'a92f4c1d8e0b',
        owner_user_address: 'a'.repeat(64),
        owner_release_cycle: 1,
        status: 'active',
        created_at: '2026-07-26T12:00:00Z',
      },
    ];

    expect(rows[0].owner_user_address).toBeUndefined();
    expect('owner_user_address' in rows[0]).toBe(false);
    expect(pendingInvitations(rows)).toHaveLength(1);
    expect(rows[1].owner_release_cycle).toBe(1);
  });
});

describe('quorum is min(configured, active) and must be surfaced with the count', () => {
  it('reports the effective quorum below the configured threshold', () => {
    const guardians = [guardian(), guardian({ id: 'x', status: 'pending_invite' })];
    const summary = summarizeQuorum(guardians, 3);

    expect(summary.activeGuardians).toBe(1);
    expect(summary.configuredThreshold).toBe(3);
    expect(summary.effectiveQuorum).toBe(1);
    expect(summary.raisesBarWithoutParticipant).toBe(true);
  });

  it('reports no gap when the configuration matches reality', () => {
    const guardians = [guardian(), guardian({ id: 'y' })];
    expect(summarizeQuorum(guardians, 2)).toMatchObject({
      activeGuardians: 2,
      effectiveQuorum: 2,
      raisesBarWithoutParticipant: false,
    });
  });

  it('counts only active guardians', () => {
    const guardians = [
      guardian(),
      guardian({ id: 'r', status: 'revoked' }),
      guardian({ id: 'p', status: 'pending_invite' }),
    ];
    expect(activeGuardians(guardians)).toHaveLength(1);
  });
});

describe('turning a guardian into a PQXDH recipient', () => {
  it('decodes the enrolled encryption keys', () => {
    const recipient = toRecipient(guardian(), 'a'.repeat(64));

    expect(recipient.username).toBe('alice1234abcd');
    expect(bytesToHex(recipient.x25519PublicKey)).toBe(vectors.x25519_key.public_key_hex);
    expect(recipient.mlkemPublicKey).toHaveLength(1184);
  });

  it('refuses a guardian with no enrolled keys rather than wrapping to nothing', () => {
    const pending = guardian({
      status: 'pending_invite',
      encryption_public_key_x25519: undefined,
      encryption_public_key_mlkem: undefined,
    });

    expect(() => toRecipient(pending, 'a'.repeat(64))).toThrow(GuardianKeysUnavailableError);
  });

  it('takes the address from the guardian row rather than asking for one', () => {
    const recipient = recipientFor(guardian());

    expect(recipient.userAddress).toBe(GUARDIAN_ADDRESS);
    expect(bytesToHex(recipient.x25519PublicKey)).toBe(vectors.x25519_key.public_key_hex);
  });

  it('refuses a guardian whose address the API withholds', () => {
    const pending = guardian({ status: 'pending_invite', user_address: undefined });

    expect(() => recipientFor(pending)).toThrow(GuardianAddressUnavailableError);
  });
});
