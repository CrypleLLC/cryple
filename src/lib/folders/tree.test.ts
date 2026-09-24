import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTestSession } from '@/test/session';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { FolderManifestInvalidError } from './manifest';
import {
  canCreateIn,
  canMoveFolder,
  childrenOf,
  createTreeFolder,
  deleteTreeFolder,
  FolderTreeProblemError,
  listTreeFolders,
  moveItemsToFolder,
  moveTreeFolder,
  pathTo,
  type TreeFolder,
  type TreeFolderRecord,
} from './tree';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function fakeServer(answer: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = {
        method: init.method ?? 'GET',
        path: new URL(url).pathname + new URL(url).search,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const { status, body } = answer(call);
      return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function folder(id: string, parentId: string | null, name = id): TreeFolder {
  return { id, parentId, name, position: 0, createdAt: '', updatedAt: '2026-09-24T10:00:00Z' };
}

describe('a folder name', () => {
  it('leaves this device sealed and comes back readable', async () => {
    const { context } = await openTestSession();
    const stored: TreeFolderRecord[] = [];
    const calls = fakeServer((call) => {
      if (call.method === 'POST') {
        const record = {
          ...(call.body as unknown as TreeFolderRecord),
          position: 0,
          created_at: '2026-09-24T10:00:00Z',
          updated_at: '2026-09-24T10:00:00Z',
        };
        stored.push(record);
        return { status: 201, body: { data: record } };
      }
      return { status: 200, body: { data: stored } };
    });

    await createTreeFolder(context, 'files', { name: '  Tax returns ', parentId: null, id: A });
    expect(JSON.stringify(calls[0].body)).not.toContain('Tax');
    expect(calls[0].body).not.toHaveProperty('parent_id');

    const folders = await listTreeFolders(context, 'files');
    expect(folders).toEqual([
      expect.objectContaining({ id: A, parentId: null, name: 'Tax returns' }),
    ]);
  });

  it('shows as unreadable, not as an error, when its key is not here', async () => {
    const { context } = await openTestSession();
    fakeServer(() => ({
      status: 200,
      body: {
        data: [
          {
            id: A,
            ciphertext: 'AAAA',
            wrapped_dek: 'AAAA',
            key_generation: 1,
            position: 0,
            created_at: '',
            updated_at: '2026-09-24T10:00:00Z',
          },
        ],
      },
    }));

    const folders = await listTreeFolders(context, 'documents');
    expect(folders[0].name).toBeUndefined();
  });
});

describe('the tree the server returns', () => {
  it('is refused when it does not hold together', async () => {
    const { context } = await openTestSession();
    const record = (id: string, parent: string) => ({
      id,
      parent_id: parent,
      ciphertext: 'AAAA',
      wrapped_dek: 'AAAA',
      key_generation: 1,
      position: 0,
      created_at: '',
      updated_at: '2026-09-24T10:00:00Z',
    });
    fakeServer(() => ({ status: 200, body: { data: [record(A, B), record(B, A)] } }));

    await expect(listTreeFolders(context, 'files')).rejects.toBeInstanceOf(FolderManifestInvalidError);
  });
});

describe('changing the tree', () => {
  it('signs a delete over the scope and the folder', async () => {
    const shared = await openTestSession();
    const calls = fakeServer(() => ({ status: 200, body: { data: { folders: 2, items: 5 } } }));

    const result = await deleteTreeFolder(shared.context, 'documents', A);

    expect(result).toEqual({ folders: 2, items: 5 });
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `/documents/folders/${A}` });
    const body = calls[0].body as { challenge: string; timestamp: number; signature: string };
    const payload = buildActionPayload(body.challenge, body.timestamp, 'folder-delete', ['documents', A]);
    expect(verifyPayload(payload, body.signature, shared.devicePublicKey)).toBe(true);
  });

  it('moves to the top level with an empty parent, and items with no folder id', async () => {
    const { context } = await openTestSession();
    const calls = fakeServer((call) => ({
      status: 200,
      body: { data: call.method === 'PUT' ? { requested: 1, moved: 1 } : { id: A } },
    }));

    await moveTreeFolder(context, 'files', A, null);
    await moveItemsToFolder(context, 'files', [B], null);
    await moveItemsToFolder(context, 'files', [B], C);

    expect(calls[0].body).toEqual({ parent: {} });
    expect(calls[1].body).toEqual({ ids: [B] });
    expect(calls[2].body).toEqual({ ids: [B], folder_id: C });
  });

  it('turns the server’s refusals into something the screen can explain', async () => {
    const { context } = await openTestSession();
    fakeServer(() => ({ status: 422, body: { code: 'FOLDER_INTO_ITSELF' } }));

    await expect(moveTreeFolder(context, 'files', A, B)).rejects.toEqual(
      new FolderTreeProblemError('FOLDER_INTO_ITSELF'),
    );
  });
});

describe('walking the tree', () => {
  const folders = [folder(A, null, 'b'), folder(B, A), folder(C, null, 'a')];

  it('lists children in order and a path from the top', () => {
    expect(childrenOf(folders, null).map((entry) => entry.id)).toEqual([C, A]);
    expect(pathTo(folders, B).map((entry) => entry.id)).toEqual([A, B]);
    expect(pathTo(folders, null)).toEqual([]);
  });

  it('never offers a move into the folder itself or its own subtree', () => {
    expect(canMoveFolder(folders, A, B)).toBe(false);
    expect(canMoveFolder(folders, A, A)).toBe(false);
    expect(canMoveFolder(folders, A, null)).toBe(false);
    expect(canMoveFolder(folders, B, null)).toBe(true);
    expect(canMoveFolder(folders, C, B)).toBe(true);
  });

  it('stops creating and moving at eight levels', () => {
    const chain = Array.from({ length: 8 }, (_, index) =>
      folder(`f${index}`, index === 0 ? null : `f${index - 1}`),
    );
    expect(canCreateIn(chain, 'f6')).toBe(true);
    expect(canCreateIn(chain, 'f7')).toBe(false);

    const withBranch = [...chain, folder('x', null), folder('y', 'x')];
    expect(canMoveFolder(withBranch, 'x', 'f5')).toBe(true);
    expect(canMoveFolder(withBranch, 'x', 'f6')).toBe(false);
  });
});
