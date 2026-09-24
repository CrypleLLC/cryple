import { ApiError, assertCanonicalUuid, request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { scopeDekWrapper } from '@/lib/keyrings/items';
import { openText, sealText } from '@/lib/sealed';
import { signActionEnvelope } from '@/lib/signing';
import {
  MAX_FOLDER_NAME_LENGTH,
  validateFolderManifest,
  type FolderManifest,
  type FolderRules,
} from './manifest';

export const TREE_SCOPES = ['documents', 'files'] as const;
export type TreeScope = (typeof TREE_SCOPES)[number];

export const MAX_TREE_DEPTH = 8;
export const TREE_RULES: FolderRules = { maxDepth: MAX_TREE_DEPTH, home: false };
export const ROOT_FOLDER = 'root';

export interface TreeFolderRecord {
  id: string;
  parent_id?: string;
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface TreeFolder {
  id: string;
  parentId: string | null;
  name: string | undefined;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderDeletion {
  folders: number;
  items: number;
}

export class FolderTreeProblemError extends Error {
  constructor(readonly code: 'FOLDER_TOO_DEEP' | 'FOLDER_INTO_ITSELF') {
    super(code === 'FOLDER_TOO_DEEP' ? 'the folder tree would be too deep' : 'a folder cannot go inside itself');
    this.name = 'FolderTreeProblemError';
  }
}

function translate(error: unknown): unknown {
  if (error instanceof ApiError && error.code === 'FOLDER_TOO_DEEP') {
    return new FolderTreeProblemError('FOLDER_TOO_DEEP');
  }
  if (error instanceof ApiError && error.code === 'FOLDER_INTO_ITSELF') {
    return new FolderTreeProblemError('FOLDER_INTO_ITSELF');
  }
  return error;
}

async function sealName(context: AuthedContext, scope: TreeScope, name: string) {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new Error(`a folder name is 1 to ${MAX_FOLDER_NAME_LENGTH} characters`);
  }
  const dek = crypto.getRandomValues(new Uint8Array(32));
  try {
    const wrapped = await scopeDekWrapper(context, scope).wrapDek(dek);
    return { ciphertext: await sealText(trimmed, dek), ...wrapped };
  } finally {
    zeroBytes(dek);
  }
}

async function openName(context: AuthedContext, scope: TreeScope, record: TreeFolderRecord): Promise<string | undefined> {
  try {
    const dek = await scopeDekWrapper(context, scope).unwrapDek(record);
    try {
      return await openText(record.ciphertext, dek);
    } finally {
      zeroBytes(dek);
    }
  } catch {
    return undefined;
  }
}

export function treeManifest(folders: readonly TreeFolder[]): FolderManifest {
  const manifest: FolderManifest = { v: 1, folders: {}, items: {} };
  for (const folder of folders) {
    manifest.folders[folder.id] = {
      name: folder.name ?? folder.id,
      parent_id: folder.parentId,
      position: folder.position,
      updated_at: folder.updatedAt,
    };
  }
  return manifest;
}

export async function listTreeFolders(context: AuthedContext, scope: TreeScope): Promise<TreeFolder[]> {
  const response = await request<TreeFolderRecord[]>({
    method: 'GET',
    path: `/${scope}/folders`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  const folders = await Promise.all(
    (response.data ?? []).map(
      async (record): Promise<TreeFolder> => ({
        id: record.id,
        parentId: record.parent_id ?? null,
        name: await openName(context, scope, record),
        position: record.position,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      }),
    ),
  );
  validateFolderManifest(treeManifest(folders), TREE_RULES);
  return folders;
}

export async function createTreeFolder(
  context: AuthedContext,
  scope: TreeScope,
  input: { name: string; parentId: string | null; id?: string },
): Promise<TreeFolderRecord> {
  const id = input.id === undefined ? crypto.randomUUID() : assertCanonicalUuid(input.id);
  try {
    const response = await request<TreeFolderRecord>({
      method: 'POST',
      path: `/${scope}/folders`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: {
        id,
        ...(input.parentId === null ? {} : { parent_id: assertCanonicalUuid(input.parentId) }),
        ...(await sealName(context, scope, input.name)),
      },
    });
    return response.data;
  } catch (error) {
    throw translate(error);
  }
}

async function patchTreeFolder(
  context: AuthedContext,
  scope: TreeScope,
  id: string,
  body: Record<string, unknown>,
): Promise<TreeFolderRecord> {
  try {
    const response = await request<TreeFolderRecord>({
      method: 'PATCH',
      path: `/${scope}/folders/${assertCanonicalUuid(id)}`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body,
    });
    return response.data;
  } catch (error) {
    throw translate(error);
  }
}

export async function renameTreeFolder(
  context: AuthedContext,
  scope: TreeScope,
  id: string,
  name: string,
): Promise<TreeFolderRecord> {
  return patchTreeFolder(context, scope, id, await sealName(context, scope, name));
}

export async function moveTreeFolder(
  context: AuthedContext,
  scope: TreeScope,
  id: string,
  parentId: string | null,
): Promise<TreeFolderRecord> {
  return patchTreeFolder(context, scope, id, {
    parent: parentId === null ? {} : { id: assertCanonicalUuid(parentId) },
  });
}

export async function deleteTreeFolder(
  context: AuthedContext,
  scope: TreeScope,
  id: string,
): Promise<FolderDeletion> {
  const folderId = assertCanonicalUuid(id);
  const response = await request<FolderDeletion>({
    method: 'DELETE',
    path: `/${scope}/folders/${folderId}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: await signActionEnvelope('folder-delete', [scope, folderId], context.session.signer()),
  });
  return response.data;
}

export async function moveItemsToFolder(
  context: AuthedContext,
  scope: TreeScope,
  itemIds: readonly string[],
  folderId: string | null,
): Promise<{ requested: number; moved: number }> {
  try {
    const response = await request<{ requested: number; moved: number }>({
      method: 'PUT',
      path: `/${scope}/folders/items`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: {
        ids: itemIds.map((id) => assertCanonicalUuid(id)),
        ...(folderId === null ? {} : { folder_id: assertCanonicalUuid(folderId) }),
      },
    });
    return response.data;
  } catch (error) {
    throw translate(error);
  }
}

export function childrenOf(folders: readonly TreeFolder[], parentId: string | null): TreeFolder[] {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.name ?? '').localeCompare(b.name ?? '') ||
        a.id.localeCompare(b.id),
    );
}

export function pathTo(folders: readonly TreeFolder[], id: string | null): TreeFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: TreeFolder[] = [];
  let current = id === null ? undefined : byId.get(id);
  while (current !== undefined && path.length <= MAX_TREE_DEPTH) {
    path.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path;
}

export function descendantsOf(folders: readonly TreeFolder[], id: string): Set<string> {
  const found = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && found.has(folder.parentId) && !found.has(folder.id)) {
        found.add(folder.id);
        grew = true;
      }
    }
  }
  return found;
}

export function canMoveFolder(folders: readonly TreeFolder[], id: string, target: string | null): boolean {
  const folder = folders.find((entry) => entry.id === id);
  if (folder === undefined || folder.parentId === target) {
    return false;
  }
  if (target === null) {
    return true;
  }
  const moving = descendantsOf(folders, id);
  if (moving.has(target)) {
    return false;
  }
  const height = Math.max(...[...moving].map((entry) => pathTo(folders, entry).length - pathTo(folders, id).length + 1));
  return pathTo(folders, target).length + height <= MAX_TREE_DEPTH;
}

export function canCreateIn(folders: readonly TreeFolder[], parentId: string | null): boolean {
  return pathTo(folders, parentId).length < MAX_TREE_DEPTH;
}

