import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { bytesToBase64, hexToBytes } from '@/lib/encoding';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { pqxdhUnwrap, parseBlob } from '@/lib/pqxdh';
import { vaultKekDekWrapper, type DekWrapper, type SecretRecord } from '@/lib/secrets';
import type { NoteRecord } from '@/lib/notes';
import type { DocumentRecord } from '@/lib/documents';
import {
  assignShare,
  BeneficiaryAccountClosedError,
  inheritableDocument,
  inheritableNote,
  inheritableSecret,
  UnsupportedItemTypeError,
  type InheritableItem,
  deleteShare,
  findItemAssignments,
  listShares,
  toRecipient,
  wrapItemKeyForHeir,
  type Beneficiary,
  type InheritanceShare,
  type SuccessionContext,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;
const ownerAddress = vectors.seed_and_user_address.user_address;

const BENEFICIARY_ID = '1a2b3c4d-4f89-11d3-9a0c-0305e82c3301';
const ITEM_ID = '6b2f0d3e-4f89-11d3-9a0c-0305e82c3301';
const SHARE_ID = '7e3d1c5a-4f89-11d3-9a0c-0305e82c3301';
const HEIR_ADDRESS = 'b'.repeat(64);

const DEK = new Uint8Array(32).fill(0x2a);

function fakeDekWrapperForTestsOnly(): DekWrapper {
  return {
    async wrapDek(dek) {
      return bytesToBase64(dek);
    },
    async unwrapDek(wrapped) {
      return Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0));
    },
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

async function newContext(
  overrides: Partial<SuccessionContext> = {},
): Promise<SuccessionContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid: true, ...overrides };
}

function beneficiary(overrides: Partial<Beneficiary> = {}): Beneficiary {
  return {
    id: BENEFICIARY_ID,
    user_uuid: '0f5c8b1e-4f89-11d3-9a0c-0305e82c3301',
    username: 'carol9876ijkl',
    user_address: HEIR_ADDRESS,
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

function secret(overrides: Partial<SecretRecord> = {}): SecretRecord {
  return {
    id: ITEM_ID,
    ciphertext: 'AQIDBA==',
    wrapped_dek: bytesToBase64(DEK),
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
    updated_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function note(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: ITEM_ID,
    ciphertext: 'AQIDBA==',
    wrapped_dek: bytesToBase64(DEK),
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
    updated_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function document(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: ITEM_ID,
    wrapped_dek: bytesToBase64(DEK),
    snapshot_ciphertext: 'AQIDBA==',
    snapshot_seq: 4,
    revision: 4,
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
    updated_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function share(overrides: Partial<InheritanceShare> = {}): InheritanceShare {
  return {
    id: SHARE_ID,
    beneficiary_id: BENEFICIARY_ID,
    item_id: ITEM_ID,
    item_type: 'secret',
    pq_hybrid_encrypted_item_key: 'opaque',
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the owner-side unwrap uses the real vault KEK by default', () => {
  it('unwraps a wrapped_dek sealed under the session vault KEK, with no override', async () => {
    mockFetch({ status: 201, body: { data: share() } });
    const wrapped_dek = await vaultKekDekWrapper(tree.vaultKek).wrapDek(DEK);

    const wrapped = await wrapItemKeyForHeir(
      await newContext(),
      inheritableSecret(secret({ wrapped_dek })),
      toRecipient(beneficiary(), HEIR_ADDRESS),
    );

    const opened = await pqxdhUnwrap(
      wrapped,
      { x25519PrivateKey: tree.x25519.privateKey, mlkemSecretKey: tree.mlkem768.secretKey },
      { usage: 'succession-dek', senderUserAddress: ownerAddress, recipientUserAddress: HEIR_ADDRESS },
    );

    expect(opened).toEqual(DEK);
  });
});

describe('assigning an item to an heir', () => {
  it('wraps the DEK so only the heir can open it', async () => {
    mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    const wrapped = await wrapItemKeyForHeir(
      context,
      inheritableSecret(secret()),
      toRecipient(beneficiary(), HEIR_ADDRESS),
    );

    const opened = await pqxdhUnwrap(
      wrapped,
      {
        x25519PrivateKey: tree.x25519.privateKey,
        mlkemSecretKey: tree.mlkem768.secretKey,
      },
      {
        usage: 'succession-dek',
        senderUserAddress: ownerAddress,
        recipientUserAddress: HEIR_ADDRESS,
      },
    );

    expect(opened).toEqual(DEK);
    expect(parseBlob(wrapped).version).toBe(0x01);
  });

  it('binds the info string — a blob wrapped for one heir address will not open under another', async () => {
    mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    const wrapped = await wrapItemKeyForHeir(
      context,
      inheritableSecret(secret()),
      toRecipient(beneficiary(), HEIR_ADDRESS),
    );

    await expect(
      pqxdhUnwrap(
        wrapped,
        {
          x25519PrivateKey: tree.x25519.privateKey,
          mlkemSecretKey: tree.mlkem768.secretKey,
        },
        {
          usage: 'succession-dek',
          senderUserAddress: ownerAddress,
          recipientUserAddress: 'c'.repeat(64),
        },
      ),
    ).rejects.toThrow();
  });

  it('will not open under a different usage label', async () => {
    mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    const wrapped = await wrapItemKeyForHeir(
      context,
      inheritableSecret(secret()),
      toRecipient(beneficiary(), HEIR_ADDRESS),
    );

    await expect(
      pqxdhUnwrap(
        wrapped,
        {
          x25519PrivateKey: tree.x25519.privateKey,
          mlkemSecretKey: tree.mlkem768.secretKey,
        },
        {
          usage: 'recovery-share',
          senderUserAddress: ownerAddress,
          recipientUserAddress: HEIR_ADDRESS,
        },
      ),
    ).rejects.toThrow();
  });

  it('signs beneficiary_id then item_id, in that order', async () => {
    const calls = mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await assignShare(context, beneficiary(), toRecipient(beneficiary(), HEIR_ADDRESS), inheritableSecret(secret()));

    const body = calls[0].body!;
    expect(body.beneficiary_id).toBe(BENEFICIARY_ID);
    expect(body.item_id).toBe(ITEM_ID);
    expect(body.item_type).toBe('secret');
    expect(body.version).toBe('v1');
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'share-assign',
          [BENEFICIARY_ID, ITEM_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('will not verify with the two arguments swapped', async () => {
    const calls = mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await assignShare(context, beneficiary(), toRecipient(beneficiary(), HEIR_ADDRESS), inheritableSecret(secret()));

    const body = calls[0].body!;
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'share-assign',
          [ITEM_ID, BENEFICIARY_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(false);
  });

  it('sends the wrapped key on the wire and never the DEK', async () => {
    const calls = mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await assignShare(context, beneficiary(), toRecipient(beneficiary(), HEIR_ADDRESS), inheritableSecret(secret()));

    const body = calls[0].body!;
    expect(body.pq_hybrid_encrypted_item_key).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(bytesToBase64(DEK));
  });

  it('refuses an heir whose account is closed', async () => {
    mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });
    const closed = beneficiary({ keys_rotated: true });

    await expect(
      assignShare(context, closed, toRecipient(beneficiary(), HEIR_ADDRESS), inheritableSecret(secret())),
    ).rejects.toThrow(BeneficiaryAccountClosedError);
  });

  it.each([
    ['note', () => inheritableNote(note())],
    ['document', () => inheritableDocument(document())],
  ])('wraps a %s the same way, and the heir opens it', async (itemType, build) => {
    const calls = mockFetch({ status: 201, body: { data: share({ item_type: itemType as never }) } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await assignShare(context, beneficiary(), toRecipient(beneficiary(), HEIR_ADDRESS), build());

    const body = calls[0].body!;
    expect(body.item_type).toBe(itemType);
    expect(body.item_id).toBe(ITEM_ID);

    const opened = await pqxdhUnwrap(
      body.pq_hybrid_encrypted_item_key as string,
      { x25519PrivateKey: tree.x25519.privateKey, mlkemSecretKey: tree.mlkem768.secretKey },
      { usage: 'succession-dek', senderUserAddress: ownerAddress, recipientUserAddress: HEIR_ADDRESS },
    );

    expect(opened).toEqual(DEK);
  });

  it('unwraps a note and a document against the real vault KEK, like a secret', async () => {
    mockFetch({ status: 201, body: { data: share() } }, { status: 201, body: { data: share() } });
    const context = await newContext();
    const wrapped_dek = await vaultKekDekWrapper(tree.vaultKek).wrapDek(DEK);

    for (const item of [
      inheritableNote(note({ wrapped_dek })),
      inheritableDocument(document({ wrapped_dek })),
    ]) {
      const wrapped = await wrapItemKeyForHeir(context, item, toRecipient(beneficiary(), HEIR_ADDRESS));

      const opened = await pqxdhUnwrap(
        wrapped,
        { x25519PrivateKey: tree.x25519.privateKey, mlkemSecretKey: tree.mlkem768.secretKey },
        { usage: 'succession-dek', senderUserAddress: ownerAddress, recipientUserAddress: HEIR_ADDRESS },
      );

      expect(opened).toEqual(DEK);
    }
  });

  it('refuses an unknown item type before anything reaches the network', async () => {
    const calls = mockFetch({ status: 201, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });
    const bogus = { type: 'credential', id: ITEM_ID, wrappedDek: bytesToBase64(DEK) } as unknown as InheritableItem;

    await expect(
      assignShare(context, beneficiary(), toRecipient(beneficiary(), HEIR_ADDRESS), bogus),
    ).rejects.toThrow(UnsupportedItemTypeError);

    expect(calls).toHaveLength(0);
  });

  it('reports the upsert — re-assigning the same pair is a 200, not a 201', async () => {
    mockFetch({ status: 200, body: { data: share() } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    const result = await assignShare(
      context,
      beneficiary(),
      toRecipient(beneficiary(), HEIR_ADDRESS),
      inheritableSecret(secret()),
    );
    expect(result.created).toBe(false);
  });
});

describe('listing and deleting shares', () => {
  it('follows pagination on a beneficiary’s shares', async () => {
    mockFetch(
      {
        status: 200,
        body: { data: [share()], page: { next_cursor: 'c1', has_more: true } },
      },
      {
        status: 200,
        body: {
          data: [share({ id: 'aa3d1c5a-4f89-11d3-9a0c-0305e82c3301' })],
          page: { has_more: false },
        },
      },
    );

    expect(await listShares(await newContext(), BENEFICIARY_ID)).toHaveLength(2);
  });

  it('sends the required body carrying the share-delete signature', async () => {
    const calls = mockFetch({ status: 204 });

    await deleteShare(await newContext(), SHARE_ID);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain(`/succession/shares/${SHARE_ID}`);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'share-delete',
          [SHARE_ID],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });
});

describe('finding who inherits an item before deleting it', () => {
  it('reports the heirs an item is assigned to', async () => {
    mockFetch({ status: 200, body: { data: [share()], page: { has_more: false } } });

    const assignments = await findItemAssignments(
      await newContext(),
      [beneficiary()],
      ITEM_ID,
    );

    expect(assignments).toHaveLength(1);
    expect(assignments[0].beneficiary.username).toBe('carol9876ijkl');
  });

  it('reports nothing when the item is assigned to no one', async () => {
    mockFetch({
      status: 200,
      body: {
        data: [share({ item_id: 'cc2f0d3e-4f89-11d3-9a0c-0305e82c3301' })],
        page: { has_more: false },
      },
    });

    expect(
      await findItemAssignments(await newContext(), [beneficiary()], ITEM_ID),
    ).toHaveLength(0);
  });
});
