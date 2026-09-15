import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { bytesToBase64 } from '@/lib/encoding';
import { generateDek, vaultKekDekWrapper } from '@/lib/secrets';
import { SessionKeystore } from '@/lib/session';
import type { AuthedContext } from '@/lib/context';
import type { ConnectionRecord } from './api';
import { shareItem } from './flows';
import { createConnectionKey, keyFingerprint, publishedRecipientKeys } from './keys';
import { fingerprintPinOptions, readFingerprintPin, type PinStorage } from './pins';
import { ConnectionNotTrustedError, verifyConnection } from './verify';

const MNEMONIC = vectors.seed_and_user_address.mnemonic;
const CONNECTION_ID = '0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e';
const COUNTERPARTY_UUID = '7d3f5a1c-2b4e-4c6a-8e0f-1a2b3c4d5e6f';
const COUNTERPARTY_ADDRESS = 'b'.repeat(64);
const ITEM_ID = '5b1d7e2a-3c4f-4a6b-9d8e-1f2a3b4c5d6e';

interface PublishedKeys {
  uuid: string;
  user_address: string;
  encryption_public_key_x25519: string;
  encryption_public_key_mlkem: string;
}

interface FakeServer {
  published?: PublishedKeys;
  calls: string[];
}

function memoryStorage(): PinStorage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

function publishedAccount(userAddress = COUNTERPARTY_ADDRESS): PublishedKeys {
  return {
    uuid: COUNTERPARTY_UUID,
    user_address: userAddress,
    encryption_public_key_x25519: bytesToBase64(x25519.getPublicKey(x25519.utils.randomSecretKey())),
    encryption_public_key_mlkem: bytesToBase64(ml_kem768.keygen().publicKey),
  };
}

function fingerprintOf(published: PublishedKeys): Promise<string> {
  return keyFingerprint(publishedRecipientKeys(published));
}

function reply(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    headers: { get: () => null },
  } as unknown as Response;
}

function stubServer(server: FakeServer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const { pathname } = new URL(url);
      server.calls.push(`${init.method} ${pathname}`);

      if (pathname === '/users/resolve') {
        return server.published === undefined
          ? reply(404, { code: 'NOT_FOUND' })
          : reply(200, {
              message: 'ok',
              data: { uuid: server.published.uuid, username: 'pedrosilva' },
            });
      }
      if (pathname === `/users/${COUNTERPARTY_UUID}/public-keys`) {
        return reply(200, { message: 'ok', data: server.published });
      }
      if (pathname === '/shares') {
        return reply(201, {
          message: 'ok',
          data: {
            id: crypto.randomUUID(),
            connection_id: CONNECTION_ID,
            item_type: 'secret',
            item_id: ITEM_ID,
            created_at: '2026-09-13T00:00:00Z',
          },
        });
      }
      return reply(404, { code: 'NOT_FOUND' });
    }),
  );
}

async function unlockedContext(): Promise<AuthedContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(MNEMONIC);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid: false };
}

function connection(over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: CONNECTION_ID,
    direction: 'outbound',
    username: 'pedrosilva',
    user_address: COUNTERPARTY_ADDRESS,
    status: 'accepted',
    created_at: '2026-09-13T00:00:00Z',
    ...over,
  };
}

async function sendableConnection(context: AuthedContext): Promise<ConnectionRecord> {
  return connection({
    sender_wrapped_key: await vaultKekDekWrapper(context.session.vaultKek).wrapDek(
      createConnectionKey(),
    ),
  });
}

function pinned(context: AuthedContext): Promise<string | undefined> {
  return readFingerprintPin(CONNECTION_ID, fingerprintPinOptions(context));
}

let server: FakeServer;

beforeEach(() => {
  server = { calls: [] };
  stubServer(server);
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => vi.unstubAllGlobals());

describe('an accepted connection whose published keys change', () => {
  it('raises the alarm, keeps the original pin, and refuses to send', async () => {
    const context = await unlockedContext();
    const original = publishedAccount();
    server.published = original;
    const conn = await sendableConnection(context);

    await expect(verifyConnection(context, conn)).resolves.toEqual({
      status: 'trusted',
      fingerprint: await fingerprintOf(original),
    });

    await context.session.unlockWithMnemonic(MNEMONIC);
    const substituted = publishedAccount();
    server.published = substituted;
    server.calls.length = 0;

    await expect(verifyConnection(context, conn)).resolves.toEqual({
      status: 'keys-changed',
      fingerprint: await fingerprintOf(substituted),
      pinned: await fingerprintOf(original),
    });
    await expect(pinned(context)).resolves.toBe(await fingerprintOf(original));

    const sending = shareItem(context, conn, { type: 'secret', id: ITEM_ID, dek: generateDek() });
    await expect(sending).rejects.toBeInstanceOf(ConnectionNotTrustedError);
    await expect(sending).rejects.toMatchObject({ trust: { status: 'keys-changed' } });
    expect(server.calls).not.toContain('POST /shares');
  });

  it('still sends while the published keys match the pin', async () => {
    const context = await unlockedContext();
    server.published = publishedAccount();
    const conn = await sendableConnection(context);

    await shareItem(context, conn, { type: 'secret', id: ITEM_ID, dek: generateDek() });
    await shareItem(context, conn, { type: 'secret', id: ITEM_ID, dek: generateDek() });

    expect(server.calls.filter((call) => call === 'POST /shares')).toHaveLength(2);
  });
});

describe('pinning', () => {
  it('pins an accepted connection the first time it is seen, on the inviting side too', async () => {
    const context = await unlockedContext();
    server.published = publishedAccount();

    await verifyConnection(context, connection({ direction: 'outbound' }));

    await expect(pinned(context)).resolves.toBe(await fingerprintOf(server.published));
  });

  it('shows an invitation still awaiting me without pinning it', async () => {
    const context = await unlockedContext();
    server.published = publishedAccount();

    await expect(
      verifyConnection(context, connection({ direction: 'inbound', status: 'pending' })),
    ).resolves.toEqual({ status: 'unpinned', fingerprint: await fingerprintOf(server.published) });
    await expect(pinned(context)).resolves.toBeUndefined();
  });

  it('compares a pending invitation this account sent against the pin written when it was sent', async () => {
    const context = await unlockedContext();
    server.published = publishedAccount();
    const outbound = connection({ direction: 'outbound', status: 'pending' });
    await verifyConnection(context, connection());

    await context.session.unlockWithMnemonic(MNEMONIC);
    server.published = publishedAccount();

    await expect(verifyConnection(context, outbound)).resolves.toMatchObject({
      status: 'keys-changed',
    });
  });
});

describe('what cannot be checked is refused, not trusted', () => {
  it('refuses when the username now leads to a different account, and pins nothing', async () => {
    const context = await unlockedContext();
    server.published = publishedAccount('c'.repeat(64));

    await expect(verifyConnection(context, connection())).resolves.toEqual({
      status: 'account-changed',
    });
    await expect(pinned(context)).resolves.toBeUndefined();
  });

  it('refuses when the counterparty cannot be resolved, and checks again next time', async () => {
    const context = await unlockedContext();

    await expect(verifyConnection(context, connection())).resolves.toEqual({
      status: 'unresolvable',
    });
    await expect(pinned(context)).resolves.toBeUndefined();

    server.published = publishedAccount();
    await expect(verifyConnection(context, connection())).resolves.toMatchObject({
      status: 'trusted',
    });
  });
});

describe('the published-key cache', () => {
  it('fetches once per session, and again after the session locks', async () => {
    const context = await unlockedContext();
    server.published = publishedAccount();
    const publicKeyReads = () =>
      server.calls.filter((call) => call.endsWith('/public-keys')).length;

    await verifyConnection(context, connection());
    await verifyConnection(context, connection());
    expect(publicKeyReads()).toBe(1);

    context.session.lock();
    await context.session.unlockWithMnemonic(MNEMONIC);
    await verifyConnection(context, connection());
    expect(publicKeyReads()).toBe(2);
  });
});
