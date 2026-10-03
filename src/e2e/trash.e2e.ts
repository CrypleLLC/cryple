import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TokenStore } from '@/lib/api';
import { completeSignUp, draftSignUp, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import { createDocumentFromSnapshot, deleteDocument, listDocumentsMeta, writeTitle } from '@/lib/documents';
import { createTreeFolder, deleteTreeFolder, listTreeFolders, moveItemsToFolder } from '@/lib/folders';
import { generateMnemonic } from '@/lib/keys';
import { SessionKeystore } from '@/lib/session';
import { listTrash, purgeEntries, restoreEntries } from '@/lib/trash';
import { getMe } from '@/lib/users';

async function signUp(): Promise<AuthedContext> {
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  await completeSignUp(services, await draftSignUp(generateMnemonic(12)), { pin: '482915', paranoid: false });
  return { session: services.session, tokens: services.tokens, paranoid: false };
}

function snapshot(title: string): Uint8Array {
  const doc = new Y.Doc();
  writeTitle(doc, title);
  return Y.encodeStateAsUpdate(doc);
}

async function liveIds(ctx: AuthedContext): Promise<string[]> {
  return (await listDocumentsMeta(ctx)).map((meta) => meta.id);
}

describe('the Trash, for documents, against a live API', () => {
  let ctx: AuthedContext;
  let retentionDays: number;

  beforeAll(async () => {
    ctx = await signUp();
    retentionDays = (await getMe(ctx)).retention_days;
  });

  it('tells the client how long this account keeps deleted items', () => {
    expect(Number.isInteger(retentionDays)).toBe(true);
  });

  it('moves a deleted document to the Trash, names it there, and restores it', async () => {
    const doc = await createDocumentFromSnapshot(ctx, snapshot('Lease agreement'));
    await deleteDocument(ctx, doc.id);
    expect(await liveIds(ctx)).not.toContain(doc.id);

    const { entries } = await listTrash(ctx, ['documents']);
    if (retentionDays === 0) {
      expect(entries).toEqual([]);
      return;
    }

    const entry = entries.find((candidate) => candidate.id === doc.id)!;
    expect(entry.name).toBe('Lease agreement');

    await restoreEntries(ctx, [entry]);
    expect(await liveIds(ctx)).toContain(doc.id);
  });

  it('restores a deleted folder whole, with what was in it', async () => {
    if (retentionDays === 0) {
      return;
    }
    const folder = await createTreeFolder(ctx, 'documents', { name: 'Taxes', parentId: null });
    const doc = await createDocumentFromSnapshot(ctx, snapshot('2025 return'));
    await moveItemsToFolder(ctx, 'documents', [doc.id], folder.id);
    await deleteTreeFolder(ctx, 'documents', folder.id);

    const { entries } = await listTrash(ctx, ['documents']);
    const entry = entries.find((candidate) => candidate.id === folder.id)!;
    expect(entry.kind).toBe('folder');
    expect(entry.name).toBe('Taxes');
    expect(entry.itemCount).toBe(1);
    expect(entries.some((candidate) => candidate.id === doc.id)).toBe(false);

    await restoreEntries(ctx, [entry]);
    expect((await listTreeFolders(ctx, 'documents')).map((tree) => tree.id)).toContain(folder.id);
    expect(await liveIds(ctx)).toContain(doc.id);
  });

  it('deletes for good from the Trash with a signed purge', async () => {
    if (retentionDays === 0) {
      return;
    }
    const doc = await createDocumentFromSnapshot(ctx, snapshot('Scratch'));
    await deleteDocument(ctx, doc.id);

    const before = await listTrash(ctx, ['documents']);
    const entry = before.entries.find((candidate) => candidate.id === doc.id)!;
    expect(await purgeEntries(ctx, [entry])).toBe(1);

    const after = await listTrash(ctx, ['documents']);
    expect(after.entries.some((candidate) => candidate.id === doc.id)).toBe(false);
    expect(await liveIds(ctx)).not.toContain(doc.id);
  });
});
