import { assertCanonicalUuid, request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import type { DocumentMetaRecord, DocumentRecord, DocumentUpdateRecord } from '@/lib/documents';
import type { FileRecord } from '@/lib/files';
import type { TreeFolderRecord, TreeScope } from '@/lib/folders';
import { signActionEnvelope } from '@/lib/signing';

export interface TrashedFolderRecord extends TreeFolderRecord {
  deleted_at: string;
  item_count: number;
}

export interface TrashedDocumentRecord extends DocumentMetaRecord {
  deleted_at: string;
}

export interface TrashedFileRecord extends FileRecord {
  deleted_at: string;
}

export interface DocumentTrashRecord {
  folders: TrashedFolderRecord[];
  documents: TrashedDocumentRecord[];
}

export interface FileTrashRecord {
  folders: TrashedFolderRecord[];
  files: TrashedFileRecord[];
}

export interface TrashedDocumentContentRecord extends DocumentRecord {
  deleted_at: string;
  updates: DocumentUpdateRecord[];
}

export interface TrashKeyRecord {
  id: string;
  wrapped_dek: string;
  key_generation: number;
}

export interface TrashKeysRecord {
  folders: TrashKeyRecord[];
  items: TrashKeyRecord[];
}

export interface TrashChangeRecord {
  requested: number;
  folders: number;
  items: number;
}

const PURGE_ACTIONS = { documents: 'document-purge', files: 'file-purge' } as const;

export async function getDocumentTrash(context: AuthedContext): Promise<DocumentTrashRecord> {
  const response = await request<DocumentTrashRecord>({
    method: 'GET',
    path: '/documents/trash',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return { folders: response.data?.folders ?? [], documents: response.data?.documents ?? [] };
}

export async function getFileTrash(context: AuthedContext): Promise<FileTrashRecord> {
  const response = await request<FileTrashRecord>({
    method: 'GET',
    path: '/files/trash',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return { folders: response.data?.folders ?? [], files: response.data?.files ?? [] };
}

export async function getTrashedDocument(
  context: AuthedContext,
  id: string,
): Promise<TrashedDocumentContentRecord> {
  const response = await request<TrashedDocumentContentRecord>({
    method: 'GET',
    path: `/documents/trash/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

function canonical(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => assertCanonicalUuid(id)))].sort();
}

export async function restoreFromTrash(
  context: AuthedContext,
  scope: TreeScope,
  ids: readonly string[],
): Promise<TrashChangeRecord> {
  const response = await request<TrashChangeRecord>({
    method: 'POST',
    path: `/${scope}/trash/restore`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ids: canonical(ids) },
  });
  return response.data;
}

export async function purgeFromTrash(
  context: AuthedContext,
  scope: TreeScope,
  ids: readonly string[],
): Promise<TrashChangeRecord> {
  const sorted = canonical(ids);
  const response = await request<TrashChangeRecord>({
    method: 'DELETE',
    path: `/${scope}/trash`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      ids: sorted,
      ...(await signActionEnvelope(PURGE_ACTIONS[scope], sorted, context.session.signer())),
    },
  });
  return response.data;
}

export async function getTrashKeys(context: AuthedContext, scope: TreeScope): Promise<TrashKeysRecord> {
  const response = await request<TrashKeysRecord>({
    method: 'GET',
    path: `/${scope}/trash/keys`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return { folders: response.data?.folders ?? [], items: response.data?.items ?? [] };
}
