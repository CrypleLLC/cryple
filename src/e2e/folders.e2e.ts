import { beforeAll, describe, expect, it } from 'vitest';
import { TokenStore, request } from '@/lib/api';
import { completeSignUp, draftSignUp, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { createDocumentFromSnapshot, listDocumentsMeta } from '@/lib/documents';
import { memoryDeviceStore } from '@/lib/device/store';
import { listFiles, uploadFile } from '@/lib/files';
import {
  createFolder,
  createTreeFolder,
  deleteTreeFolder,
  editFolders,
  FolderTreeProblemError,
  folderOf,
  HOME_FOLDER_ID,
  listTreeFolders,
  loadFolders,
  MANIFEST_SCOPE_RULES,
  moveItemsToFolder,
  moveTreeFolder,
  placeItem,
  renameTreeFolder,
} from '@/lib/folders';
import { generateMnemonic } from '@/lib/keys';
import { createSecret } from '@/lib/secrets';
import { SessionKeystore } from '@/lib/session';

async function signUp(): Promise<AuthedContext> {
  const store = memoryDeviceStore();
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store,
  };
  await completeSignUp(services, await draftSignUp(generateMnemonic(12)), { pin: '482915', paranoid: false });
  return { session: services.session, tokens: services.tokens, paranoid: false };
}

function secondTab(ctx: AuthedContext): AuthedContext {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  session.adoptHandoff(ctx.session.exportForHandoff());
  return { ...ctx, session };
}

function smallFile(name: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type: 'text/plain',
    size: bytes.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice());
          controller.close();
        },
      }),
  };
}

beforeAll(async () => {
  const health = await request<unknown>({ method: 'GET', path: '/ready' });
  expect(health.status).toBe(200);
});

describe('133.1 and 133.2 — the sealed tabs', () => {
  it('files a secret in a tab that another session opens', async () => {
    const ctx = await signUp();
    const { secret } = await createSecret(ctx, JSON.stringify({ name: 'Bank', value: 'pin 1234' }));

    await editFolders(ctx, 'secrets', createFolder({ id: '00000000-0000-4000-8000-0000000000b1', name: 'Banks' }));
    await editFolders(ctx, 'secrets', placeItem(secret.id, '00000000-0000-4000-8000-0000000000b1'));

    const elsewhere = await loadFolders(secondTab(ctx), 'secrets', { fresh: true });
    expect(elsewhere.folders['00000000-0000-4000-8000-0000000000b1'].name).toBe('Banks');
    expect(folderOf(elsewhere, secret.id, MANIFEST_SCOPE_RULES.secrets)).toBe(
      '00000000-0000-4000-8000-0000000000b1',
    );

    const notes = await loadFolders(ctx, 'notes', { fresh: true });
    expect(Object.keys(notes.folders)).toEqual([HOME_FOLDER_ID]);
  });
});

describe('133.3 — folders in documents and the drive', () => {
  let ctx: AuthedContext;

  beforeAll(async () => {
    ctx = await signUp();
  });

  it('builds a document tree, files a document, and deletes the subtree with it', async () => {
    const top = await createTreeFolder(ctx, 'documents', { name: 'Work', parentId: null });
    const inner = await createTreeFolder(ctx, 'documents', { name: '2026', parentId: top.id });
    await renameTreeFolder(ctx, 'documents', inner.id, 'Year 2026');

    const folders = await listTreeFolders(ctx, 'documents');
    expect(folders.map((folder) => folder.name).sort()).toEqual(['Work', 'Year 2026']);

    const document = await createDocumentFromSnapshot(ctx, new Uint8Array([0, 0]));
    const kept = await createDocumentFromSnapshot(ctx, new Uint8Array([0, 0]));
    await moveItemsToFolder(ctx, 'documents', [document.id], inner.id);

    expect((await listDocumentsMeta(ctx, { folder: inner.id })).map((meta) => meta.id)).toEqual([document.id]);
    expect((await listDocumentsMeta(ctx, { folder: 'root' })).map((meta) => meta.id)).toEqual([kept.id]);

    await expect(moveTreeFolder(ctx, 'documents', top.id, inner.id)).rejects.toEqual(
      new FolderTreeProblemError('FOLDER_INTO_ITSELF'),
    );

    expect(await deleteTreeFolder(ctx, 'documents', top.id)).toEqual({ folders: 2, items: 1 });
    expect((await listDocumentsMeta(ctx)).map((meta) => meta.id)).toEqual([kept.id]);
    expect(await listTreeFolders(ctx, 'documents')).toEqual([]);
  });

  it('refuses a ninth level', async () => {
    let parent: string | null = null;
    for (let depth = 1; depth <= 8; depth += 1) {
      parent = (await createTreeFolder(ctx, 'documents', { name: `level ${depth}`, parentId: parent })).id;
    }
    await expect(createTreeFolder(ctx, 'documents', { name: 'level 9', parentId: parent })).rejects.toEqual(
      new FolderTreeProblemError('FOLDER_TOO_DEEP'),
    );
  });

  it('files an uploaded file and takes it away with its folder', async () => {
    const folder = await createTreeFolder(ctx, 'files', { name: 'Receipts', parentId: null });
    const file = await uploadFile(ctx, smallFile('receipt.txt', 'twelve euros'));
    await moveItemsToFolder(ctx, 'files', [file.id], folder.id);

    const inside = await listFiles(ctx, { folder: folder.id });
    expect(inside.map((record) => [record.id, record.folder_id])).toEqual([[file.id, folder.id]]);
    expect(await listFiles(ctx, { folder: 'root' })).toEqual([]);

    expect(await deleteTreeFolder(ctx, 'files', folder.id)).toEqual({ folders: 1, items: 1 });
    expect(await listFiles(ctx)).toEqual([]);
  });
});
