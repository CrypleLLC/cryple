import * as Y from 'yjs';
import type { AuthedContext } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { openDocumentDek, openUpdate, readTitle } from '@/lib/documents';
import { openManifest, wrapper as fileDekWrapper } from '@/lib/files';
import { openTreeFolderName, type TreeScope } from '@/lib/folders';
import {
  getDocumentTrash,
  getFileTrash,
  getTrashedDocument,
  purgeFromTrash,
  restoreFromTrash,
  type TrashedFileRecord,
  type TrashedFolderRecord,
} from './api';

export type TrashKind = 'folder' | 'document' | 'file';

export interface TrashEntry {
  key: string;
  scope: TreeScope;
  kind: TrashKind;
  id: string;
  companions: string[];
  name: string | undefined;
  deletedAt: string;
  itemCount?: number;
  sizeBytes?: number;
  mime?: string;
}

export interface TrashListing {
  entries: TrashEntry[];
  failed: TreeScope[];
}

async function folderEntry(
  context: AuthedContext,
  scope: TreeScope,
  record: TrashedFolderRecord,
): Promise<TrashEntry> {
  return {
    key: `${scope}:folder:${record.id}`,
    scope,
    kind: 'folder',
    id: record.id,
    companions: [],
    name: await openTreeFolderName(context, scope, record),
    deletedAt: record.deleted_at,
    itemCount: record.item_count,
  };
}

export async function trashedDocumentTitle(context: AuthedContext, id: string): Promise<string | undefined> {
  const content = await getTrashedDocument(context, id);
  const dek = await openDocumentDek(context, content);
  const doc = new Y.Doc();
  try {
    if (content.snapshot_ciphertext !== '') {
      Y.applyUpdate(doc, await openUpdate(content.snapshot_ciphertext, dek));
    }
    for (const update of content.updates) {
      Y.applyUpdate(doc, await openUpdate(update.ciphertext, dek));
    }
    return readTitle(doc);
  } finally {
    zeroBytes(dek);
    doc.destroy();
  }
}

async function documentEntries(context: AuthedContext): Promise<TrashEntry[]> {
  const trash = await getDocumentTrash(context);
  const folders = await Promise.all(trash.folders.map((record) => folderEntry(context, 'documents', record)));
  const documents = await Promise.all(
    trash.documents.map(
      async (record): Promise<TrashEntry> => ({
        key: `documents:document:${record.id}`,
        scope: 'documents',
        kind: 'document',
        id: record.id,
        companions: [],
        name: await trashedDocumentTitle(context, record.id).catch(() => undefined),
        deletedAt: record.deleted_at,
      }),
    ),
  );
  return [...folders, ...documents];
}

interface OpenedFile {
  record: TrashedFileRecord;
  name?: string;
  mime?: string;
  size?: number;
  thumbnailId?: string;
}

async function openFile(context: AuthedContext, record: TrashedFileRecord): Promise<OpenedFile> {
  try {
    const dek = await fileDekWrapper(context).unwrapDek(record);
    try {
      const manifest = await openManifest(record.ciphertext, dek);
      return { record, name: manifest.name, mime: manifest.mime, size: manifest.size, thumbnailId: manifest.thumbnail_id };
    } finally {
      zeroBytes(dek);
    }
  } catch {
    return { record };
  }
}

async function fileEntries(context: AuthedContext): Promise<TrashEntry[]> {
  const trash = await getFileTrash(context);
  const folders = await Promise.all(trash.folders.map((record) => folderEntry(context, 'files', record)));
  const opened = await Promise.all(trash.files.map((record) => openFile(context, record)));
  const trashedIds = new Set(opened.map((file) => file.record.id));
  const thumbnails = new Set(
    opened.flatMap((file) =>
      file.thumbnailId !== undefined && trashedIds.has(file.thumbnailId) ? [file.thumbnailId] : [],
    ),
  );

  const files = opened
    .filter((file) => !thumbnails.has(file.record.id))
    .map(
      (file): TrashEntry => ({
        key: `files:file:${file.record.id}`,
        scope: 'files',
        kind: 'file',
        id: file.record.id,
        companions: file.thumbnailId !== undefined && thumbnails.has(file.thumbnailId) ? [file.thumbnailId] : [],
        name: file.name,
        deletedAt: file.record.deleted_at,
        sizeBytes: file.size,
        mime: file.mime,
      }),
    );
  return [...folders, ...files];
}

export async function listTrash(context: AuthedContext, scopes: readonly TreeScope[]): Promise<TrashListing> {
  const loaders: Record<TreeScope, (context: AuthedContext) => Promise<TrashEntry[]>> = {
    documents: documentEntries,
    files: fileEntries,
  };
  const outcomes = await Promise.allSettled(scopes.map((scope) => loaders[scope](context)));

  const entries: TrashEntry[] = [];
  const failed: TreeScope[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      entries.push(...outcome.value);
    } else {
      failed.push(scopes[index]);
    }
  });

  entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.key.localeCompare(b.key));
  return { entries, failed };
}

function idsByScope(entries: readonly TrashEntry[]): Map<TreeScope, string[]> {
  const grouped = new Map<TreeScope, string[]>();
  for (const entry of entries) {
    const ids = grouped.get(entry.scope) ?? [];
    ids.push(entry.id, ...entry.companions);
    grouped.set(entry.scope, ids);
  }
  return grouped;
}

export async function restoreEntries(context: AuthedContext, entries: readonly TrashEntry[]): Promise<number> {
  let restored = 0;
  for (const [scope, ids] of idsByScope(entries)) {
    const out = await restoreFromTrash(context, scope, ids);
    restored += out.items + out.folders;
  }
  return restored;
}

export async function purgeEntries(context: AuthedContext, entries: readonly TrashEntry[]): Promise<number> {
  let purged = 0;
  for (const [scope, ids] of idsByScope(entries)) {
    const out = await purgeFromTrash(context, scope, ids);
    purged += out.items + out.folders;
  }
  return purged;
}
