import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTestSession } from '@/test/session';
import type { AuthedContext } from '@/lib/context';
import { sha256Hex, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { deriveShareSubkey } from '@/lib/keyrings/crypto';
import { sealBlob } from '@/lib/sealed';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import {
  createFolder,
  FolderEditError,
  FolderManifestInvalidError,
  liveFolders,
  placeItem,
  renameFolder,
  folderOf,
} from '@/lib/folders';
import type { ConnectionFoldersRecord, ConnectionRecord } from './api';
import { createConnectionKey, wrapUnderConnection } from './keys';
import { sharedFoldersSubkey } from './flows';
import { editSharedFolders, loadSharedFolders, resetSharedFolders, SHARED_FOLDER_RULES } from './folders';

const CONNECTION_ID = '0c892e57-93cf-423a-a9e9-fee5a9f87681';

interface FakeServer {
  calls: string[];
  row?: ConnectionFoldersRecord;
  bodies: Record<string, unknown>[];
  generation: number;
  connections: ConnectionRecord[];
}

function fakeServer(generation = 1): FakeServer {
  const server: FakeServer = { calls: [], bodies: [], generation, connections: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init.method ?? 'GET';
      server.calls.push(`${method} ${path}`);
      const answer = (status: number, body?: unknown) =>
        ({
          status,
          ok: status >= 200 && status < 300,
          text: async () => (body === undefined ? '' : JSON.stringify(body)),
          headers: { get: () => null },
        }) as unknown as Response;

      if (path === '/connections' && method === 'GET') {
        return answer(200, { data: server.connections });
      }
      if (path !== `/connections/${CONNECTION_ID}/folders`) {
        return answer(404, { code: 'NOT_FOUND' });
      }
      if (method === 'GET') {
        return server.row ? answer(200, { data: server.row }) : answer(404, { code: 'NOT_FOUND' });
      }
      const body = JSON.parse(String(init.body));
      server.bodies.push(body);
      if (body.recipient_key_generation !== server.generation) {
        return answer(409, { code: 'STALE_KEY_GENERATION' });
      }
      if (body.expected_revision !== (server.row?.revision ?? 0)) {
        return answer(409, { code: 'CONFLICT' });
      }
      server.row = {
        ciphertext: body.ciphertext,
        wrapped_dek: body.wrapped_dek,
        revision: (server.row?.revision ?? 0) + 1,
        recipient_key_generation: server.generation,
        updated_at: new Date().toISOString(),
      };
      return answer(200, { data: server.row });
    }),
  );
  return server;
}

async function side(
  context: AuthedContext,
  connectionKey: Uint8Array,
  over: Partial<ConnectionRecord> = {},
): Promise<ConnectionRecord> {
  const { generation, kek } = context.session.currentKek('sharing');
  return {
    id: CONNECTION_ID,
    direction: 'outbound',
    username: 'anacosta',
    user_address: 'b'.repeat(64),
    status: 'accepted',
    sender_wrapped_key: await sealBlob(connectionKey, kek),
    sender_key_generation: generation,
    recipient_key_generation: 1,
    keys: [],
    created_at: '2026-10-02T00:00:00Z',
    ...over,
  };
}

async function sealedRow(
  connectionKey: Uint8Array,
  text: string,
  over: Partial<ConnectionFoldersRecord> = {},
): Promise<ConnectionFoldersRecord> {
  const subkey = await sharedFoldersSubkey(connectionKey);
  const dek = crypto.getRandomValues(new Uint8Array(32));
  try {
    return {
      ciphertext: await sealBlob(utf8ToBytes(text), dek),
      wrapped_dek: await wrapUnderConnection(subkey, dek),
      revision: 4,
      recipient_key_generation: 1,
      updated_at: new Date().toISOString(),
      ...over,
    };
  } finally {
    zeroBytes(subkey, dek);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the folders inside a friendship', () => {
  it('starts with no folders and no home, without writing', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    const manifest = await loadSharedFolders(context, await side(context, createConnectionKey()));

    expect(liveFolders(manifest)).toEqual([]);
    expect(folderOf(manifest, 'any-share', SHARED_FOLDER_RULES)).toBeNull();
    expect(server.calls).toEqual([`GET /connections/${CONNECTION_ID}/folders`]);
  });

  it('is sealed so the other side opens it, and keeps the names off the wire', async () => {
    const key = createConnectionKey();
    const mine = await openTestSession();
    const theirs = await openTestSession();
    const server = fakeServer();

    await editSharedFolders(mine.context, await side(mine.context, key), createFolder({ id: 'trip', name: 'Lisbon trip' }));

    expect(server.row?.revision).toBe(1);
    expect(JSON.stringify(server.bodies)).not.toContain('Lisbon');

    const opened = await loadSharedFolders(theirs.context, await side(theirs.context, key), { fresh: true });
    expect(opened.folders.trip.name).toBe('Lisbon trip');
  });

  it('signs the connection, the revision it replaces, the key it was sealed under and the digest', async () => {
    const shared = await openTestSession();
    const server = fakeServer(3);

    await editSharedFolders(
      shared.context,
      await side(shared.context, createConnectionKey(), { recipient_key_generation: 3 }),
      createFolder({ id: 'bills', name: 'Bills' }),
    );

    const body = server.bodies[0] as { challenge: string; timestamp: number; signature: string; ciphertext: string };
    const digest = await sha256Hex(utf8ToBytes(body.ciphertext));
    const payload = buildActionPayload(body.challenge, body.timestamp, 'connection-folders-update', [
      CONNECTION_ID,
      0,
      3,
      digest,
    ]);
    expect(verifyPayload(payload, body.signature, shared.devicePublicKey)).toBe(true);
  });

  it('lets either side file anything in a folder the other created, merging after a 409', async () => {
    const key = createConnectionKey();
    const mine = await openTestSession();
    const theirs = await openTestSession();
    const server = fakeServer();
    const myside = await side(mine.context, key);
    const theirside = await side(theirs.context, key);

    await editSharedFolders(mine.context, myside, createFolder({ id: 'photos', name: 'Photos' }));
    await loadSharedFolders(theirs.context, theirside, { fresh: true });
    await editSharedFolders(mine.context, myside, createFolder({ id: 'bills', name: 'Bills' }));

    const merged = await editSharedFolders(theirs.context, theirside, placeItem('their-share', 'photos'));

    expect(liveFolders(merged).map((folder) => folder.id).sort()).toEqual(['bills', 'photos']);
    expect(folderOf(merged, 'their-share', SHARED_FOLDER_RULES)).toBe('photos');
    expect(server.row?.revision).toBe(3);

    const renamed = await editSharedFolders(theirs.context, theirside, renameFolder('photos', 'Pictures'));
    expect(renamed.folders.photos.name).toBe('Pictures');
  });

  it('files into a folder the other side created since this side last looked', async () => {
    const key = createConnectionKey();
    const mine = await openTestSession();
    const theirs = await openTestSession();
    const server = fakeServer();
    const myside = await side(mine.context, key);
    const theirside = await side(theirs.context, key);

    await loadSharedFolders(theirs.context, theirside);
    await editSharedFolders(mine.context, myside, createFolder({ id: 'photos', name: 'Photos' }));

    const filed = await editSharedFolders(theirs.context, theirside, placeItem('their-share', 'photos'));

    expect(folderOf(filed, 'their-share', SHARED_FOLDER_RULES)).toBe('photos');
    expect(server.row?.revision).toBe(2);
  });

  it('goes eight levels deep and no further', async () => {
    const { context } = await openTestSession();
    fakeServer();
    const connection = await side(context, createConnectionKey());

    let parentId: string | null = null;
    for (let level = 1; level <= 8; level += 1) {
      await editSharedFolders(context, connection, createFolder({ id: `level-${level}`, name: `Level ${level}`, parentId }));
      parentId = `level-${level}`;
    }

    await expect(
      editSharedFolders(context, connection, createFolder({ id: 'level-9', name: 'Level 9', parentId })),
    ).rejects.toBeInstanceOf(FolderEditError);
  });

  it('follows a re-establishment it has not seen yet, rather than failing to open', async () => {
    const { context } = await openTestSession();
    const server = fakeServer(2);
    const oldKey = createConnectionKey();
    const newKey = createConnectionKey();
    const stale = await side(context, oldKey, { recipient_key_generation: 1 });
    server.connections = [await side(context, newKey, { recipient_key_generation: 2 })];
    server.row = await sealedRow(newKey, JSON.stringify({ v: 1, folders: {}, items: {} }), {
      recipient_key_generation: 2,
    });

    await editSharedFolders(context, stale, createFolder({ id: 'after', name: 'After the rotation' }));

    expect(stale.recipient_key_generation).toBe(2);
    expect(server.calls).toContain('GET /connections');
    expect(server.row?.revision).toBe(5);
  });

  it('refreshes the connection when the server says the key moved, and seals under the new one', async () => {
    const { context } = await openTestSession();
    const server = fakeServer(2);
    const newKey = createConnectionKey();
    const stale = await side(context, createConnectionKey(), { recipient_key_generation: 1 });
    server.connections = [await side(context, newKey, { recipient_key_generation: 2 })];

    await editSharedFolders(context, stale, createFolder({ id: 'first', name: 'First' }));

    expect(server.bodies.map((body) => body.recipient_key_generation)).toEqual([1, 2]);
    const reopened = await loadSharedFolders(context, await side(context, newKey, { recipient_key_generation: 2 }), {
      fresh: true,
    });
    expect(reopened.folders.first.name).toBe('First');
  });

  it('keeps the folders under a key of their own, separate from every item scope', async () => {
    const key = createConnectionKey();
    const folders = await sharedFoldersSubkey(key);
    for (const scope of ['secrets', 'notes', 'documents', 'files']) {
      expect([...(await deriveShareSubkey(key, scope))]).not.toEqual([...folders]);
    }
  });

  it('reports a tree that fails validation, and resets it for both sides on request', async () => {
    const key = createConnectionKey();
    const { context } = await openTestSession();
    const server = fakeServer();
    const cycle = {
      v: 1,
      folders: {
        a: { name: 'A', parent_id: 'b', position: 0, updated_at: '2026-10-02T10:00:00Z' },
        b: { name: 'B', parent_id: 'a', position: 0, updated_at: '2026-10-02T10:00:00Z' },
      },
      items: {},
    };
    server.row = await sealedRow(key, JSON.stringify(cycle));
    const connection = await side(context, key);

    await expect(loadSharedFolders(context, connection)).rejects.toBeInstanceOf(FolderManifestInvalidError);
    await expect(editSharedFolders(context, connection, createFolder({ name: 'X' }))).rejects.toBeInstanceOf(
      FolderManifestInvalidError,
    );

    const reset = await resetSharedFolders(context, connection);
    expect(liveFolders(reset)).toEqual([]);
    expect(server.row?.revision).toBe(5);
  });
});
