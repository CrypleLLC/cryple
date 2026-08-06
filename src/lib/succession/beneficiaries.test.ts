import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { bytesToHex, hexToBytes } from '@/lib/encoding';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import type { AuthedContext } from '@/lib/context';
import {
  BeneficiaryAccountClosedError,
  BeneficiaryAddressMismatchError,
  closedAccountBeneficiaries,
  deleteBeneficiary,
  isAccountClosed,
  listBeneficiaries,
  registerBeneficiary,
  resolveRecipient,
  SuccessionValidationError,
  toRecipient,
  type Beneficiary,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;

const BENEFICIARY_ID = '1a2b3c4d-4f89-11d3-9a0c-0305e82c3301';
const HEIR_ADDRESS = 'b'.repeat(64);

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

function beneficiary(overrides: Partial<Beneficiary> = {}): Beneficiary {
  return {
    id: BENEFICIARY_ID,
    user_uuid: '0f5c8b1e-4f89-11d3-9a0c-0305e82c3301',
    username: 'carol9876ijkl',
    encrypted_label: 'AQIDBA==',
    public_key_x25519_snapshot: vectors.x25519_key.public_key_base64,
    public_key_mlkem_snapshot: vectors.mlkem768_key.public_key_base64,
    status: 'active',
    keys_rotated: false,
    share_count: 0,
    created_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('registering a beneficiary', () => {
  it('signs the username, so the heir cannot be swapped after the fact', async () => {
    const calls = mockFetch({ status: 201, body: { data: beneficiary() } });

    await registerBeneficiary(await newContext(), 'carol9876ijkl', 'AQIDBA==');

    const body = calls[0].body!;
    expect(calls[0].method).toBe('POST');
    expect(body.beneficiary_username).toBe('carol9876ijkl');
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'beneficiary-register',
          ['carol9876ijkl'],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('will not verify against a different username', async () => {
    const calls = mockFetch({ status: 201, body: { data: beneficiary() } });
    await registerBeneficiary(await newContext(), 'carol9876ijkl', 'AQIDBA==');

    const body = calls[0].body!;
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'beneficiary-register',
          ['attacker9999'],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(false);
  });

  it('omits the key snapshots — supplying them only adds a mismatch failure mode', async () => {
    const calls = mockFetch({ status: 201, body: { data: beneficiary() } });
    await registerBeneficiary(await newContext(), 'carol9876ijkl', 'AQIDBA==');

    expect(Object.keys(calls[0].body!).sort()).toEqual([
      'beneficiary_username',
      'challenge',
      'encrypted_label',
      'password',
      'signature',
      'timestamp',
    ]);
  });

  it('carries the owner second factor — naming an heir touches the inheritance graph', async () => {
    const paranoid = mockFetch({ status: 201, body: { data: beneficiary() } });
    await registerBeneficiary(await newContext(true), 'carol9876ijkl', 'AQIDBA==');
    expect(paranoid[0].body).toHaveProperty('password');

    vi.unstubAllGlobals();
    const standard = mockFetch({ status: 201, body: { data: beneficiary() } });
    await registerBeneficiary(await newContext(false), 'carol9876ijkl', 'AQIDBA==');
    expect(standard[0].body).not.toHaveProperty('password');
  });

  it('refuses an empty label rather than letting the server reject it', async () => {
    mockFetch({ status: 201, body: { data: beneficiary() } });
    await expect(
      registerBeneficiary(await newContext(), 'carol9876ijkl', ''),
    ).rejects.toThrow(SuccessionValidationError);
  });

  it('reports dropped_shares as 0 when the key is absent, never as undefined', async () => {
    mockFetch({ status: 201, body: { data: beneficiary() } });
    const result = await registerBeneficiary(await newContext(), 'carol9876ijkl', 'AQIDBA==');

    expect(result.droppedShares).toBe(0);
    expect(result.created).toBe(true);
    expect(result.beneficiary.dropped_shares).toBeUndefined();
  });

  it('surfaces dropped_shares when the server does report it', async () => {
    mockFetch({ status: 200, body: { data: beneficiary({ dropped_shares: 2 }) } });
    const result = await registerBeneficiary(await newContext(), 'carol9876ijkl', 'AQIDBA==');

    expect(result.droppedShares).toBe(2);
    expect(result.created).toBe(false);
  });
});

describe('listing beneficiaries', () => {
  it('follows pagination until has_more is false', async () => {
    mockFetch(
      {
        status: 200,
        body: {
          data: [beneficiary()],
          page: { next_cursor: 'c1', has_more: true },
        },
      },
      {
        status: 200,
        body: {
          data: [beneficiary({ id: '7b3d5e1c-4f89-11d3-9a0c-0305e82c3301' })],
          page: { has_more: false },
        },
      },
    );

    expect(await listBeneficiaries(await newContext())).toHaveLength(2);
  });
});

describe('keys_rotated means the heir deleted their account', () => {
  const closed = beneficiary({ keys_rotated: true, username: '', user_uuid: '' });

  it('flags the row and picks it out of a list', () => {
    expect(isAccountClosed(closed)).toBe(true);
    expect(closedAccountBeneficiaries([beneficiary(), closed])).toHaveLength(1);
  });

  it('refuses to build a recipient from it — there is nothing to wrap to', () => {
    expect(() => toRecipient(closed, HEIR_ADDRESS)).toThrow(BeneficiaryAccountClosedError);
  });

  it('says remove and choose another, never re-register', () => {
    let message = '';
    try {
      toRecipient(closed, HEIR_ADDRESS);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/remove them and choose another/);
    expect(message).not.toMatch(/re-wrap/);
  });
});

describe('turning a beneficiary into a PQXDH recipient', () => {
  it('decodes the stored key snapshot', () => {
    const recipient = toRecipient(beneficiary(), HEIR_ADDRESS);

    expect(recipient.username).toBe('carol9876ijkl');
    expect(recipient.userAddress).toBe(HEIR_ADDRESS);
    expect(bytesToHex(recipient.x25519PublicKey)).toBe(vectors.x25519_key.public_key_hex);
    expect(recipient.mlkemPublicKey).toHaveLength(1184);
  });

  it('checks the supplied address really is that heir before wrapping', async () => {
    mockFetch({ status: 200, body: { data: { username: 'carol9876ijkl' } } });

    const recipient = await resolveRecipient(beneficiary(), HEIR_ADDRESS);
    expect(recipient.userAddress).toBe(HEIR_ADDRESS);
  });

  it('rejects an address belonging to someone else — the info string would be wrong', async () => {
    mockFetch({ status: 200, body: { data: { username: 'someone9999' } } });

    await expect(resolveRecipient(beneficiary(), HEIR_ADDRESS)).rejects.toThrow(
      BeneficiaryAddressMismatchError,
    );
  });
});

describe('deleting a beneficiary', () => {
  it('sends the required body carrying the beneficiary-delete signature', async () => {
    const calls = mockFetch({ status: 204 });

    await deleteBeneficiary(await newContext(), BENEFICIARY_ID);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain(`/succession/beneficiaries/${BENEFICIARY_ID}`);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'beneficiary-delete',
          [BENEFICIARY_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('refuses a non-canonical id before sending', async () => {
    mockFetch({ status: 204 });
    await expect(
      deleteBeneficiary(await newContext(), BENEFICIARY_ID.toUpperCase()),
    ).rejects.toThrow(/canonical/);
  });
});
