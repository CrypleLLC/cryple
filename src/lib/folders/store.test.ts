import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTestSession } from '@/test/session';
import type { AuthedContext } from '@/lib/context';
import { sha256Hex, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { sealBlob } from '@/lib/sealed';
import { SessionKeystore } from '@/lib/session';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import type { FolderManifestRecord, ManifestScope } from './api';
import {
  createFolder,
  FolderManifestInvalidError,
  HOME_FOLDER_ID,
  liveFolders,
  placeItem,
  renameFolder,
} from './manifest';
import { editFolders, loadFolders, resetFolders } from './store';

interface FakeServer {
  calls: string[];
  rows: Partial<Record<ManifestScope, FolderManifestRecord>>;
  bodies: Record<string, unknown>[];
}

function fakeServer(): FakeServer {
  const server: FakeServer = { calls: [], rows: {}, bodies: [] };
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

      const scope = path.split('/')[1] as ManifestScope;
      if (path !== `/${scope}/folders`) {
        return answer(404, { code: 'NOT_FOUND' });
      }
      if (method === 'GET') {
        const row = server.rows[scope];
        return row ? answer(200, { data: row }) : answer(404, { code: 'NOT_FOUND' });
      }
      const body = JSON.parse(String(init.body));
      server.bodies.push(body);
      if (body.expected_revision !== (server.rows[scope]?.revision ?? 0)) {
        return answer(409, { code: 'CONFLICT' });
      }
      server.rows[scope] = {
        scope,
        ciphertext: body.ciphertext,
        wrapped_dek: body.wrapped_dek,
        key_generation: body.key_generation,
        revision: (server.rows[scope]?.revision ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };
      return answer(200, { data: server.rows[scope] });
    }),
  );
  return server;
}

function cloneContext(context: AuthedContext): AuthedContext {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  session.adoptHandoff(context.session.exportForHandoff());
  return { ...context, session };
}

async function sealedRow(context: AuthedContext, scope: ManifestScope, text: string): Promise<FolderManifestRecord> {
  const { generation, kek } = context.session.currentKek(scope);
  const dek = crypto.getRandomValues(new Uint8Array(32));
  try {
    return {
      scope,
      ciphertext: await sealBlob(utf8ToBytes(text), dek),
      wrapped_dek: await sealBlob(dek, kek),
      key_generation: generation,
      revision: 7,
      updated_at: new Date().toISOString(),
    };
  } finally {
    zeroBytes(dek);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sealed folder manifest', () => {
  it('starts from home when the server holds nothing, without writing', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    const manifest = await loadFolders(context, 'notes');

    expect(liveFolders(manifest).map((folder) => folder.id)).toEqual([HOME_FOLDER_ID]);
    expect(server.calls).toEqual(['GET /notes/folders']);
  });

  it('seals a write that another device opens, and keeps the names off the wire', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    await editFolders(context, 'secrets', createFolder({ id: 'banks', name: 'Seed phrases and banks' }));

    const row = server.rows.secrets as FolderManifestRecord;
    expect(row.revision).toBe(1);
    expect(JSON.stringify(server.bodies)).not.toContain('Seed phrases');

    const reopened = await loadFolders(cloneContext(context), 'secrets', { fresh: true });
    expect(reopened.folders.banks.name).toBe('Seed phrases and banks');
  });

  it('signs the scope, the revision it replaces and the digest of the ciphertext', async () => {
    const shared = await openTestSession();
    const server = fakeServer();

    await editFolders(shared.context, 'notes', createFolder({ id: 'books', name: 'Books' }));

    const body = server.bodies[0] as { challenge: string; timestamp: number; signature: string; ciphertext: string };
    const digest = await sha256Hex(utf8ToBytes(body.ciphertext));
    const payload = buildActionPayload(body.challenge, body.timestamp, 'folders-update', ['notes', 0, digest]);
    expect(verifyPayload(payload, body.signature, shared.devicePublicKey)).toBe(true);
  });

  it('keeps each scope in its own manifest', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    await editFolders(context, 'secrets', createFolder({ id: 'banks', name: 'Banks' }));
    const notes = await loadFolders(context, 'notes');

    expect(Object.keys(notes.folders)).toEqual([HOME_FOLDER_ID]);
    expect(server.calls).toContain('GET /notes/folders');
  });

  it('merges two devices’ concurrent edits by folder id after a 409', async () => {
    const { context } = await openTestSession();
    const other = cloneContext(context);
    const server = fakeServer();

    await editFolders(context, 'notes', createFolder({ id: 'books', name: 'Books' }));
    await loadFolders(other, 'notes', { fresh: true });
    await editFolders(context, 'notes', createFolder({ id: 'shopping', name: 'Shopping' }));

    const merged = await editFolders(other, 'notes', renameFolder('books', 'Reading list'));

    expect(liveFolders(merged).map((folder) => [folder.id, folder.name])).toEqual([
      [HOME_FOLDER_ID, 'home'],
      ['books', 'Reading list'],
      ['shopping', 'Shopping'],
    ]);
    expect(server.calls.filter((call) => call === 'PUT /notes/folders')).toHaveLength(4);
    expect(server.rows.notes?.revision).toBe(3);
  });

  it('writes nothing when the edit changes nothing', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    await editFolders(context, 'notes', placeItem('item', null));
    await editFolders(context, 'notes', placeItem('item', null));

    expect(server.calls.filter((call) => call === 'PUT /notes/folders')).toHaveLength(1);
  });

  it('reports a tree that fails validation rather than handing it on', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();
    const cycle = {
      v: 1,
      folders: {
        home: { name: 'home', parent_id: null, position: 0, updated_at: '2026-09-24T10:00:00Z' },
        a: { name: 'A', parent_id: 'b', position: 0, updated_at: '2026-09-24T10:00:00Z' },
        b: { name: 'B', parent_id: 'a', position: 0, updated_at: '2026-09-24T10:00:00Z' },
      },
      items: {},
    };
    server.rows.secrets = await sealedRow(context, 'secrets', JSON.stringify(cycle));

    await expect(loadFolders(context, 'secrets')).rejects.toBeInstanceOf(FolderManifestInvalidError);
    await expect(editFolders(context, 'secrets', createFolder({ name: 'X' }))).rejects.toBeInstanceOf(
      FolderManifestInvalidError,
    );
    expect(server.calls).not.toContain('PUT /secrets/folders');
  });

  it('resets a tree that fails validation to home alone, over the stored revision', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();
    server.rows.notes = await sealedRow(context, 'notes', '{"v":1,"folders":{},"items":{}}');

    await expect(loadFolders(context, 'notes')).rejects.toBeInstanceOf(FolderManifestInvalidError);
    const reset = await resetFolders(context, 'notes');

    expect(liveFolders(reset).map((folder) => folder.id)).toEqual([HOME_FOLDER_ID]);
    expect(server.rows.notes?.revision).toBe(8);
    expect(await loadFolders(cloneContext(context), 'notes', { fresh: true })).toEqual(reset);
  });

  it('forgets the manifest when the session locks', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    await loadFolders(context, 'notes');
    context.session.lock();
    await loadFolders(context, 'notes').catch(() => undefined);

    expect(server.calls.filter((call) => call === 'GET /notes/folders')).toHaveLength(2);
  });
});
