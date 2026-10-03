import { describe, expect, it } from 'vitest';
import { TokenStore } from '@/lib/api';
import { completeSignUp, draftSignUp, readVerifiedChain, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import * as Y from 'yjs';
import {
  createFolder,
  createTreeFolder,
  deleteTreeFolder,
  editFolders,
  getFolderManifest,
  listTreeFolderRecords,
  listTreeFolders,
  loadFolders,
  moveItemsToFolder,
} from '@/lib/folders';
import { deriveRootKeysFromMnemonic, generateMnemonic, zeroRootKeys } from '@/lib/keys';
import { applyDeviceBatch, buildRotation, wrapKekForRoot } from '@/lib/keyrings';
import { rewrapAfterRotation } from '@/lib/rekey';
import { createDocumentFromSnapshot, getDocument } from '@/lib/documents';
import { listTrash, restoreEntries } from '@/lib/trash';
import { getMe } from '@/lib/users';
import { SessionKeystore } from '@/lib/session';

async function signUp(): Promise<{ ctx: AuthedContext; mnemonic: string }> {
  const mnemonic = generateMnemonic(12);
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  await completeSignUp(services, await draftSignUp(mnemonic), { pin: '482915', paranoid: false });
  return { ctx: { session: services.session, tokens: services.tokens, paranoid: false }, mnemonic };
}

async function rotate(ctx: AuthedContext, mnemonic: string, scopes: ('documents' | 'notes')[]) {
  const root = await deriveRootKeysFromMnemonic(mnemonic);
  try {
    const state = await readVerifiedChain(
      ctx,
      { userAddress: ctx.session.userAddress, rootPublicKey: ctx.session.rootPublicKey },
      ctx.session.deviceId,
    );
    const built = await buildRotation({
      state,
      author: { name: ctx.session.deviceId, signer: ctx.session.signer() },
      wrapForRoot: (kek) => wrapKekForRoot(root.wrapKey, kek),
      scopes,
    });
    await applyDeviceBatch(ctx, built.batch);
    ctx.session.addKeyrings(
      built.created.map((created, index) => ({
        scope: created.scope,
        generation: 2,
        kek: created.kek,
        sealedMaterial: built.batch.materials[index]?.sealed_material,
      })),
      Object.fromEntries(scopes.map((scope) => [scope, 2])),
    );
  } finally {
    zeroRootKeys(root);
  }
}

describe('a rotation leaves no folder name behind', () => {
  it('re-wraps the documents tree and re-seals the notes tabs under the new generation', async () => {
    const { ctx, mnemonic } = await signUp();
    const folder = await createTreeFolder(ctx, 'documents', { name: 'Contracts', parentId: null });
    await editFolders(ctx, 'notes', createFolder({ name: 'Travel' }));

    await rotate(ctx, mnemonic, ['documents', 'notes']);

    const outcomes = await rewrapAfterRotation(ctx, ['documents', 'notes']);
    expect(Object.fromEntries(outcomes.map((outcome) => [outcome.scope, outcome.folders]))).toEqual({
      notes: 1,
      documents: 1,
    });

    const [record] = await listTreeFolderRecords(ctx, 'documents');
    expect(record.id).toBe(folder.id);
    expect(record.key_generation).toBe(2);
    expect(record.ciphertext).toBe(folder.ciphertext);
    expect((await listTreeFolders(ctx, 'documents'))[0].name).toBe('Contracts');

    expect((await getFolderManifest(ctx, 'notes'))?.key_generation).toBe(2);
    const tabs = await loadFolders(ctx, 'notes', { fresh: true });
    expect(Object.values(tabs.folders).map((tab) => tab.name)).toContain('Travel');

    const again = await rewrapAfterRotation(ctx, ['documents', 'notes']);
    expect(again.map((outcome) => outcome.folders)).toEqual([0, 0]);
  });

  it('re-wraps what waits in the Trash, so a restore after a rotation brings no retired key back', async () => {
    const { ctx, mnemonic } = await signUp();
    if ((await getMe(ctx)).retention_days === 0) {
      return;
    }
    const folder = await createTreeFolder(ctx, 'documents', { name: 'Archive', parentId: null });
    const doc = await createDocumentFromSnapshot(ctx, Y.encodeStateAsUpdate(new Y.Doc()));
    await moveItemsToFolder(ctx, 'documents', [doc.id], folder.id);
    await deleteTreeFolder(ctx, 'documents', folder.id);

    await rotate(ctx, mnemonic, ['documents']);
    const [outcome] = await rewrapAfterRotation(ctx, ['documents']);
    expect(outcome).toMatchObject({ scope: 'documents', requested: 1, rekeyed: 1, folders: 1 });

    const { entries } = await listTrash(ctx, ['documents']);
    expect(entries.find((entry) => entry.id === folder.id)?.name).toBe('Archive');
    await restoreEntries(ctx, entries.filter((entry) => entry.id === folder.id));

    expect((await getDocument(ctx, doc.id)).key_generation).toBe(2);
    const [record] = await listTreeFolderRecords(ctx, 'documents');
    expect(record.key_generation).toBe(2);
  });
});
