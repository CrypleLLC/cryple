import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { openTestSession } from '@/test/session';
import type { AuthedContext } from '@/lib/context';
import { sealUpdate, writeTitle } from '@/lib/documents';
import { buildManifest, sealManifest } from '@/lib/files';
import { scopeDekWrapper } from '@/lib/keyrings/items';
import { sealText } from '@/lib/sealed';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { listTrash, purgeEntries, restoreEntries } from './entries';

const FOLDER = '00000000-0000-4000-8000-000000000001';
const DOCUMENT = '00000000-0000-4000-8000-000000000002';
const PHOTO = '00000000-0000-4000-8000-000000000003';
const PREVIEW = '00000000-0000-4000-8000-000000000004';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function answer(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    headers: { get: () => null },
  } as unknown as Response;
}

async function sealed(context: AuthedContext, scope: 'documents' | 'files', dek: Uint8Array) {
  return scopeDekWrapper(context, scope).wrapDek(dek);
}

async function fixtures(context: AuthedContext) {
  const folderDek = crypto.getRandomValues(new Uint8Array(32));
  const folder = {
    id: FOLDER,
    ciphertext: await sealText('Old projects', folderDek),
    ...(await sealed(context, 'documents', folderDek)),
    position: 0,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    deleted_at: '2026-10-02T10:00:00Z',
    item_count: 3,
  };

  const documentDek = crypto.getRandomValues(new Uint8Array(32));
  const doc = new Y.Doc();
  writeTitle(doc, 'Tax return');
  const document = {
    id: DOCUMENT,
    ...(await sealed(context, 'documents', documentDek)),
    snapshot_seq: 0,
    latest_seq: 1,
    revision: 1,
    version: 'v1',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    deleted_at: '2026-10-03T10:00:00Z',
  };
  const content = {
    ...document,
    snapshot_ciphertext: '',
    updates: [{ seq: 1, ciphertext: await sealUpdate(Y.encodeStateAsUpdate(doc), documentDek), created_at: '' }],
  };

  const file = async (id: string, name: string, thumbnailId?: string) => {
    const dek = crypto.getRandomValues(new Uint8Array(32));
    return {
      id,
      ciphertext: await sealManifest(buildManifest({ name, mime: 'image/jpeg', size: 10, thumbnailId }), dek),
      ...(await sealed(context, 'files', dek)),
      size_bytes: 65573,
      ciphertext_sha256: 'a'.repeat(64),
      version: 'v1',
      r2_state: 'ok',
      gcs_state: 'ok',
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      deleted_at: '2026-10-01T12:00:00Z',
    };
  };

  return {
    documents: { folders: [folder], documents: [document] },
    content,
    files: { folders: [], files: [await file(PHOTO, 'beach.jpg', PREVIEW), await file(PREVIEW, 'thumbnail.jpg')] },
  };
}

function fakeServer(data: Awaited<ReturnType<typeof fixtures>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init.method ?? 'GET';
      const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ method, path, body });

      if (path === '/documents/trash' && method === 'GET') {
        return answer(200, { data: data.documents });
      }
      if (path === `/documents/trash/${DOCUMENT}`) {
        return answer(200, { data: data.content });
      }
      if (path === '/files/trash' && method === 'GET') {
        return answer(200, { data: data.files });
      }
      if (path.endsWith('/trash/restore') || (path.endsWith('/trash') && method === 'DELETE')) {
        return answer(200, { data: { requested: body.ids.length, folders: 0, items: body.ids.length } });
      }
      return answer(404, { code: 'NOT_FOUND' });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Trash', () => {
  it('names every entry on this device and lists the newest deletion first', async () => {
    const { context } = await openTestSession();
    fakeServer(await fixtures(context));

    const { entries, failed } = await listTrash(context, ['documents', 'files']);

    expect(failed).toEqual([]);
    expect(entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ['document', 'Tax return'],
      ['folder', 'Old projects'],
      ['file', 'beach.jpg'],
    ]);
    expect(entries.find((entry) => entry.kind === 'folder')?.itemCount).toBe(3);
  });

  it('hides a thumbnail and carries it with the file it belongs to', async () => {
    const { context } = await openTestSession();
    fakeServer(await fixtures(context));

    const { entries } = await listTrash(context, ['files']);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(PHOTO);
    expect(entries[0].companions).toEqual([PREVIEW]);
  });

  it('asks only for the scopes this device holds', async () => {
    const { context } = await openTestSession();
    const calls = fakeServer(await fixtures(context));

    await listTrash(context, ['documents']);

    expect(calls.some((call) => call.path.startsWith('/files'))).toBe(false);
  });

  it('restores per scope, with each file’s thumbnail, and signs nothing', async () => {
    const { context } = await openTestSession();
    const calls = fakeServer(await fixtures(context));
    const { entries } = await listTrash(context, ['documents', 'files']);

    await restoreEntries(context, entries);

    const restores = calls.filter((call) => call.path.endsWith('/trash/restore'));
    expect(restores.map((call) => [call.path, call.body?.ids])).toEqual([
      ['/documents/trash/restore', [FOLDER, DOCUMENT]],
      ['/files/trash/restore', [PHOTO, PREVIEW]],
    ]);
    expect(restores.every((call) => call.body?.signature === undefined)).toBe(true);
  });

  it('signs a purge over exactly the sorted ids it sends', async () => {
    const shared = await openTestSession();
    const calls = fakeServer(await fixtures(shared.context));
    const { entries } = await listTrash(shared.context, ['files']);

    await purgeEntries(shared.context, entries);

    const purge = calls.find((call) => call.method === 'DELETE')!;
    expect(purge.path).toBe('/files/trash');
    expect(purge.body?.ids).toEqual([PHOTO, PREVIEW]);
    const payload = buildActionPayload(
      purge.body?.challenge as string,
      purge.body?.timestamp as number,
      'file-purge',
      [PHOTO, PREVIEW],
    );
    expect(verifyPayload(payload, purge.body?.signature as string, shared.devicePublicKey)).toBe(true);
  });

  it('reports a scope that could not be read rather than hiding the other', async () => {
    const { context } = await openTestSession();
    const data = await fixtures(context);
    fakeServer(data);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/files/trash') {
          return answer(500, { code: 'INTERNAL' });
        }
        if (path === '/documents/trash') {
          return answer(200, { data: data.documents });
        }
        return answer(200, { data: data.content });
      }),
    );

    const { entries, failed } = await listTrash(context, ['documents', 'files']);

    expect(failed).toEqual(['files']);
    expect(entries.map((entry) => entry.kind).sort()).toEqual(['document', 'folder']);
  });
});
