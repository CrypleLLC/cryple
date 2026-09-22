import { afterEach, describe, expect, it, vi } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { openTestSession } from '@/test/session';
import { ChainState, eventHash, type ChainEvent, type StoredChainEvent } from '@/lib/chain';
import { deviceDeclaration, deviceSigner, generateDeviceKeys } from '@/lib/device/keys';
import { uncompressedPointToSpkiBase64 } from '@/lib/encoding';
import { buildGenesis, buildRotation } from '@/lib/keyrings';
import { FULL_DEVICE_SCOPES } from '@/lib/scopes';
import { rawKeySigner } from '@/lib/signing';
import type { AuthedContext } from '@/lib/context';
import type { PublicKeysRecord } from '@/lib/users';
import type { ConnectionRecord } from './api';
import {
  editAddressBook,
  loadAddressBook,
  mergeAddressBooks,
  setNickname,
  emptyAddressBook,
} from './address-book';
import { rootFingerprint } from './keys';
import {
  assertConnectionTrusted,
  ConnectionNotTrustedError,
  forgetPublishedCounterparties,
  verifyConnection,
} from './verify';
import { SessionKeystore } from '@/lib/session';

const UUID = '0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e';

function stored(events: readonly ChainEvent[], from: number): StoredChainEvent[] {
  return events.map((event, index) => ({
    ...event,
    seq: from + index,
    event_hash: eventHash(event.statement, event.signer, event.signature),
  }));
}

async function counterparty(userAddress = 'c'.repeat(64)) {
  const rootPrivate = p256.utils.randomSecretKey();
  const rootPublicKey = uncompressedPointToSpkiBase64(p256.getPublicKey(rootPrivate, false));
  const device = await generateDeviceKeys({ preferWebCryptoX25519: false });
  const built = await buildGenesis({
    userAddress,
    rootPublicKey,
    root: rawKeySigner(rootPrivate),
    wrapForRoot: async () => 'AQ'.padEnd(64, 'A'),
    device: deviceDeclaration(device, FULL_DEVICE_SCOPES),
  });
  const events = stored(built.batch.events, 1);
  const state = ChainState.replay(userAddress, rootPublicKey, events);
  const published = (): PublicKeysRecord => {
    const current = state.currentSharingKeys()!;
    return {
      uuid: '0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e',
      user_address: userAddress,
      root_public_key: rootPublicKey,
      sharing_keys: {
        generation: current.generation,
        encryption_public_key_x25519: current.keys.x25519PublicKey,
        encryption_public_key_mlkem: current.keys.mlkemPublicKey,
      },
      proof: [events[1]],
    };
  };
  return { userAddress, rootPublicKey, device, state, events, published };
}

interface BookRow {
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  revision: number;
  updated_at: string;
}

function fakeServer(options: {
  resolve: () => { uuid: string; username: string } | undefined;
  publicKeys: () => PublicKeysRecord;
  book?: { row?: BookRow };
  conflictOnce?: () => Promise<void>;
}) {
  const book = options.book ?? {};
  const calls: string[] = [];
  let conflictPending = options.conflictOnce;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const answer = (status: number, body?: unknown) =>
        ({
          status,
          ok: status >= 200 && status < 300,
          text: async () => (body === undefined ? '' : JSON.stringify(body)),
          headers: { get: () => null },
        }) as unknown as Response;

      if (path === '/users/resolve') {
        const resolved = options.resolve();
        return resolved ? answer(200, { data: resolved }) : answer(404, { code: 'NOT_FOUND' });
      }
      if (path.endsWith('/public-keys')) {
        return answer(200, { data: options.publicKeys() });
      }
      if (path === '/sharing/address-book' && method === 'GET') {
        return book.row ? answer(200, { data: book.row }) : answer(404, { code: 'NOT_FOUND' });
      }
      if (path === '/sharing/address-book' && method === 'PUT') {
        if (conflictPending) {
          const run = conflictPending;
          conflictPending = undefined;
          await run();
        }
        const body = JSON.parse(String(init.body));
        if (body.expected_revision !== (book.row?.revision ?? 0)) {
          return answer(409, { code: 'CONFLICT' });
        }
        book.row = {
          ciphertext: body.ciphertext,
          wrapped_dek: body.wrapped_dek,
          key_generation: body.key_generation,
          revision: (book.row?.revision ?? 0) + 1,
          updated_at: new Date().toISOString(),
        };
        return answer(200, { data: book.row });
      }
      return answer(404, { code: 'NOT_FOUND' });
    }),
  );
  return { calls, book };
}

function connection(over: Partial<ConnectionRecord> & { user_address: string }): ConnectionRecord {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    direction: 'outbound',
    username: 'pedrosilva',
    status: 'accepted',
    sender_key_generation: 1,
    recipient_key_generation: 1,
    keys: [],
    created_at: '2026-09-21T00:00:00Z',
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

async function freshContext(): Promise<AuthedContext> {
  return (await openTestSession()).context;
}

describe('a contact is trusted through their root key, pinned in the address book', () => {
  it('pins an accepted connection on first sight, in the sealed address book', async () => {
    const them = await counterparty();
    const server = fakeServer({ resolve: () => ({ uuid: UUID, username: 'pedrosilva' }), publicKeys: them.published });
    const context = await freshContext();

    const trust = await verifyConnection(context, connection({ user_address: them.userAddress }));

    expect(trust).toEqual({ status: 'trusted', fingerprint: await rootFingerprint(them.rootPublicKey) });
    expect(server.calls).toContain('PUT /sharing/address-book');
    const book = await loadAddressBook(context, { fresh: true });
    expect(book.pins[them.userAddress].root_public_key).toBe(them.rootPublicKey);
  });

  it('does not raise the alarm when their sharing keys rotate with a proof path back to the pinned root', async () => {
    const them = await counterparty();
    let record = them.published();
    fakeServer({ resolve: () => ({ uuid: UUID, username: 'pedrosilva' }), publicKeys: () => record });
    const context = await freshContext();
    const accepted = connection({ user_address: them.userAddress });
    expect((await verifyConnection(context, accepted)).status).toBe('trusted');

    const rotation = await buildRotation({
      state: them.state,
      author: { name: them.device.deviceId, signer: deviceSigner(them.device) },
      wrapForRoot: async () => 'AQ'.padEnd(64, 'A'),
      scopes: ['sharing'],
    });
    const rotated = stored(rotation.batch.events, 4);
    const current = them.state.currentSharingKeys()!;
    record = {
      ...record,
      sharing_keys: {
        generation: current.generation,
        encryption_public_key_x25519: current.keys.x25519PublicKey,
        encryption_public_key_mlkem: current.keys.mlkemPublicKey,
      },
      proof: [them.events[0], rotated[1]],
    };
    forgetPublishedCounterparties(context.session);

    const trust = await verifyConnection(context, accepted);
    expect(current.generation).toBe(2);
    expect(trust.status).toBe('trusted');
  });

  it('raises the alarm and refuses to send when the root key differs from the pin', async () => {
    const them = await counterparty();
    const impostor = await counterparty(them.userAddress);
    let record = them.published();
    const server = fakeServer({ resolve: () => ({ uuid: UUID, username: 'pedrosilva' }), publicKeys: () => record });
    const context = await freshContext();
    const accepted = connection({ user_address: them.userAddress });
    await verifyConnection(context, accepted);

    record = impostor.published();
    forgetPublishedCounterparties(context.session);

    const trust = await verifyConnection(context, accepted);
    expect(trust.status).toBe('root-changed');
    await expect(assertConnectionTrusted(context, accepted)).rejects.toBeInstanceOf(ConnectionNotTrustedError);
    expect(server.calls).not.toContain('POST /shares');
    const book = await loadAddressBook(context, { fresh: true });
    expect(book.pins[them.userAddress].root_public_key).toBe(them.rootPublicKey);
  });

  it('refuses sharing keys whose proof path does not end at the root', async () => {
    const them = await counterparty();
    const stranger = await counterparty();
    fakeServer({
      resolve: () => ({ uuid: UUID, username: 'pedrosilva' }),
      publicKeys: () => ({ ...them.published(), sharing_keys: stranger.published().sharing_keys }),
    });
    const trust = await verifyConnection(await freshContext(), connection({ user_address: them.userAddress }));
    expect(trust.status).toBe('proof-invalid');
  });

  it('shows an invitation still awaiting me without pinning it', async () => {
    const them = await counterparty();
    const server = fakeServer({ resolve: () => ({ uuid: UUID, username: 'pedrosilva' }), publicKeys: them.published });
    const trust = await verifyConnection(
      await freshContext(),
      connection({ user_address: them.userAddress, direction: 'inbound', status: 'pending' }),
    );
    expect(trust.status).toBe('unpinned');
    expect(server.calls).not.toContain('PUT /sharing/address-book');
  });

  it('refuses when the username now leads to another account, and pins nothing', async () => {
    const them = await counterparty();
    const server = fakeServer({
      resolve: () => ({ uuid: UUID, username: 'pedrosilva' }),
      publicKeys: () => ({ ...them.published(), user_address: 'd'.repeat(64) }),
    });
    const trust = await verifyConnection(await freshContext(), connection({ user_address: them.userAddress }));
    expect(trust.status).toBe('account-changed');
    expect(server.calls).not.toContain('PUT /sharing/address-book');
  });

  it('refuses a counterparty that is gone, and checks again next time instead of remembering', async () => {
    const them = await counterparty();
    let gone = true;
    const server = fakeServer({
      resolve: () => (gone ? undefined : { uuid: UUID, username: 'pedrosilva' }),
      publicKeys: them.published,
    });
    const context = await freshContext();
    const accepted = connection({ user_address: them.userAddress });

    expect((await verifyConnection(context, accepted)).status).toBe('unresolvable');
    gone = false;
    expect((await verifyConnection(context, accepted)).status).toBe('trusted');
    expect(server.calls.filter((call) => call === 'GET /users/resolve')).toHaveLength(2);
  });

  it('reads published keys once per session, and again after a lock', async () => {
    const them = await counterparty();
    const server = fakeServer({ resolve: () => ({ uuid: UUID, username: 'pedrosilva' }), publicKeys: them.published });
    const { context } = await openTestSession();
    const accepted = connection({ user_address: them.userAddress });
    const material = context.session.exportForHandoff();

    await verifyConnection(context, accepted);
    await verifyConnection(context, accepted);
    expect(server.calls.filter((call) => call.endsWith('/public-keys'))).toHaveLength(1);

    context.session.lock();
    context.session.adoptHandoff(material);
    await verifyConnection(context, accepted);
    expect(server.calls.filter((call) => call.endsWith('/public-keys'))).toHaveLength(2);
  });
});

describe('the address book', () => {
  it('merges two devices’ concurrent edits by connection id after a 409', async () => {
    const shared = await openTestSession();
    const other = { ...shared.context, session: cloneSession(shared.context) };
    const server = fakeServer({
      resolve: () => undefined,
      publicKeys: () => {
        throw new Error('unused');
      },
    });

    await editAddressBook(shared.context, setNickname('conn-a', 'Pedro'));
    await loadAddressBook(other, { fresh: true });
    await editAddressBook(shared.context, setNickname('conn-b', 'Ana'));

    const merged = await editAddressBook(other, setNickname('conn-c', 'Rui'));
    expect(Object.keys(merged.nicknames).sort()).toEqual(['conn-a', 'conn-b', 'conn-c']);
    expect(server.calls.filter((call) => call === 'PUT /sharing/address-book')).toHaveLength(4);
    expect(server.book.row?.revision).toBe(3);
  });

  it('never replaces a pin that already stands when two books meet', () => {
    const stored = emptyAddressBook();
    stored.pins.a = { root_public_key: 'first', pinned_at: '2026-09-21T00:00:00Z' };
    const local = emptyAddressBook();
    local.pins.a = { root_public_key: 'second', pinned_at: '2026-09-21T01:00:00Z' };
    local.nicknames.x = { name: 'X', updated_at: '2026-09-21T01:00:00Z' };

    const merged = mergeAddressBooks(stored, local);
    expect(merged.pins.a.root_public_key).toBe('first');
    expect(merged.nicknames.x.name).toBe('X');
  });

  it('holds no readable nickname or pin on the wire', async () => {
    const them = await counterparty();
    const server = fakeServer({ resolve: () => ({ uuid: UUID, username: 'pedrosilva' }), publicKeys: them.published });
    const context = await freshContext();
    await editAddressBook(context, setNickname('conn-a', 'Pedro Silva'));
    await verifyConnection(context, connection({ user_address: them.userAddress }));

    const row = JSON.stringify(server.book.row);
    expect(row).not.toContain('Pedro');
    expect(row).not.toContain(them.userAddress);
  });
});

function cloneSession(context: AuthedContext): SessionKeystore {
  const copy = new SessionKeystore({ idleTimeoutMs: 0 });
  copy.adoptHandoff(context.session.exportForHandoff());
  return copy;
}
