export const FOLDER_MANIFEST_VERSION = 1;
export const HOME_FOLDER_ID = 'home';
export const HOME_FOLDER_NAME = 'home';
export const MAX_FOLDER_NAME_LENGTH = 120;

export interface FolderRules {
  maxDepth: number;
  home: boolean;
}

export interface FolderEntry {
  name: string;
  parent_id: string | null;
  position: number;
  updated_at: string;
  deleted_at?: string;
}

export interface ItemPlacement {
  folder_id: string | null;
  updated_at: string;
}

export interface FolderManifest {
  v: typeof FOLDER_MANIFEST_VERSION;
  folders: Record<string, FolderEntry>;
  items: Record<string, ItemPlacement>;
}

export interface Folder extends FolderEntry {
  id: string;
}

export type FolderManifestProblem =
  | 'unknown-version'
  | 'malformed'
  | 'bad-name'
  | 'unknown-parent'
  | 'cycle'
  | 'too-deep'
  | 'deleted-parent'
  | 'missing-home'
  | 'unknown-folder';

export class FolderManifestInvalidError extends Error {
  constructor(
    readonly problem: FolderManifestProblem,
    readonly folderId?: string,
  ) {
    super(`the folder manifest failed validation: ${problem}${folderId === undefined ? '' : ` (${folderId})`}`);
    this.name = 'FolderManifestInvalidError';
  }
}

export type FolderEditProblem =
  | 'bad-name'
  | 'unknown-folder'
  | 'folder-exists'
  | 'home-is-fixed'
  | 'into-itself'
  | 'too-deep';

export class FolderEditError extends Error {
  constructor(
    readonly problem: FolderEditProblem,
    readonly folderId?: string,
  ) {
    super(`the folder edit was refused: ${problem}${folderId === undefined ? '' : ` (${folderId})`}`);
    this.name = 'FolderEditError';
  }
}

export type FolderEdit = (manifest: FolderManifest, rules: FolderRules) => FolderManifest;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFolderName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_FOLDER_NAME_LENGTH;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isFolderReference(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value !== '');
}

function readFolder(id: string, value: unknown): FolderEntry {
  if (
    !isRecord(value) ||
    !isFolderReference(value.parent_id) ||
    typeof value.position !== 'number' ||
    !Number.isFinite(value.position) ||
    !isTimestamp(value.updated_at) ||
    (value.deleted_at !== undefined && !isTimestamp(value.deleted_at))
  ) {
    throw new FolderManifestInvalidError('malformed', id);
  }
  if (!isFolderName(value.name)) {
    throw new FolderManifestInvalidError('bad-name', id);
  }
  const entry: FolderEntry = {
    name: value.name,
    parent_id: value.parent_id,
    position: value.position,
    updated_at: value.updated_at,
  };
  if (value.deleted_at !== undefined) {
    entry.deleted_at = value.deleted_at;
  }
  return entry;
}

function readPlacement(id: string, value: unknown): ItemPlacement {
  if (!isRecord(value) || !isFolderReference(value.folder_id) || !isTimestamp(value.updated_at)) {
    throw new FolderManifestInvalidError('malformed', id);
  }
  return { folder_id: value.folder_id, updated_at: value.updated_at };
}

export function parseFolderManifest(text: string): FolderManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FolderManifestInvalidError('malformed');
  }
  if (!isRecord(parsed)) {
    throw new FolderManifestInvalidError('malformed');
  }
  if (parsed.v !== FOLDER_MANIFEST_VERSION) {
    throw new FolderManifestInvalidError('unknown-version');
  }
  if (!isRecord(parsed.folders) || !isRecord(parsed.items)) {
    throw new FolderManifestInvalidError('malformed');
  }

  const folders: Record<string, FolderEntry> = {};
  for (const [id, value] of Object.entries(parsed.folders)) {
    folders[id] = readFolder(id, value);
  }
  const items: Record<string, ItemPlacement> = {};
  for (const [id, value] of Object.entries(parsed.items)) {
    items[id] = readPlacement(id, value);
  }
  return { v: FOLDER_MANIFEST_VERSION, folders, items };
}

export function emptyFolderManifest(rules: FolderRules, at = new Date()): FolderManifest {
  const manifest: FolderManifest = { v: FOLDER_MANIFEST_VERSION, folders: {}, items: {} };
  if (rules.home) {
    manifest.folders[HOME_FOLDER_ID] = {
      name: HOME_FOLDER_NAME,
      parent_id: null,
      position: 0,
      updated_at: at.toISOString(),
    };
  }
  return manifest;
}

function has(folders: Record<string, FolderEntry>, id: string): boolean {
  return Object.hasOwn(folders, id);
}

function findCycle(folders: Record<string, FolderEntry>, startId: string): string[] | undefined {
  const seen = new Map<string, number>();
  const path: string[] = [];
  let current: string | null = startId;
  while (current !== null && has(folders, current)) {
    const index = seen.get(current);
    if (index !== undefined) {
      return path.slice(index);
    }
    seen.set(current, path.length);
    path.push(current);
    current = folders[current].parent_id;
  }
  return undefined;
}

function depthOf(folders: Record<string, FolderEntry>, id: string): number {
  let depth = 0;
  let current: string | null = id;
  while (current !== null && has(folders, current) && depth <= Object.keys(folders).length) {
    depth += 1;
    current = folders[current].parent_id;
  }
  return depth;
}

function subtreeHeight(folders: Record<string, FolderEntry>, id: string): number {
  let height = 1;
  for (const [childId, child] of Object.entries(folders)) {
    if (child.parent_id === id && child.deleted_at === undefined) {
      height = Math.max(height, 1 + subtreeHeight(folders, childId));
    }
  }
  return height;
}

function isLive(folders: Record<string, FolderEntry>, id: string): boolean {
  return has(folders, id) && folders[id].deleted_at === undefined;
}

export function validateFolderManifest(manifest: FolderManifest, rules: FolderRules): FolderManifest {
  const { folders, items } = manifest;

  for (const [id, folder] of Object.entries(folders)) {
    if (folder.parent_id !== null && !has(folders, folder.parent_id)) {
      throw new FolderManifestInvalidError('unknown-parent', id);
    }
  }
  for (const id of Object.keys(folders)) {
    if (findCycle(folders, id) !== undefined) {
      throw new FolderManifestInvalidError('cycle', id);
    }
  }
  for (const [id, folder] of Object.entries(folders)) {
    if (folder.deleted_at !== undefined) {
      continue;
    }
    if (folder.parent_id !== null && !isLive(folders, folder.parent_id)) {
      throw new FolderManifestInvalidError('deleted-parent', id);
    }
    if (depthOf(folders, id) > rules.maxDepth) {
      throw new FolderManifestInvalidError('too-deep', id);
    }
  }
  if (rules.home && (!isLive(folders, HOME_FOLDER_ID) || folders[HOME_FOLDER_ID].parent_id !== null)) {
    throw new FolderManifestInvalidError('missing-home', HOME_FOLDER_ID);
  }
  for (const [id, placement] of Object.entries(items)) {
    if (placement.folder_id !== null && !has(folders, placement.folder_id)) {
      throw new FolderManifestInvalidError('unknown-folder', id);
    }
  }
  return manifest;
}

function later<T extends { updated_at: string }>(stored: T | undefined, local: T | undefined): T | undefined {
  if (stored === undefined) {
    return local;
  }
  if (local === undefined) {
    return stored;
  }
  return local.updated_at > stored.updated_at ? local : stored;
}

function mergeRecords<T extends { updated_at: string }>(
  stored: Record<string, T>,
  local: Record<string, T>,
): Record<string, T> {
  const merged: Record<string, T> = { ...stored };
  for (const [id, entry] of Object.entries(local)) {
    const winner = later(merged[id], entry);
    if (winner !== undefined) {
      merged[id] = winner;
    }
  }
  return merged;
}

function breakCycles(folders: Record<string, FolderEntry>): void {
  for (const id of Object.keys(folders).sort()) {
    const cycle = findCycle(folders, id);
    if (cycle === undefined) {
      continue;
    }
    const latest = [...cycle].sort((a, b) =>
      folders[a].updated_at === folders[b].updated_at
        ? a.localeCompare(b)
        : folders[a].updated_at.localeCompare(folders[b].updated_at),
    )[cycle.length - 1];
    folders[latest] = { ...folders[latest], parent_id: null };
  }
}

function cascadeDeletions(folders: Record<string, FolderEntry>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, folder] of Object.entries(folders)) {
      if (folder.deleted_at !== undefined || folder.parent_id === null) {
        continue;
      }
      const parent = folders[folder.parent_id];
      if (parent?.deleted_at !== undefined) {
        folders[id] = { ...folder, deleted_at: parent.deleted_at };
        changed = true;
      }
    }
  }
}

function liftTooDeep(folders: Record<string, FolderEntry>, maxDepth: number): void {
  for (;;) {
    const offender = Object.keys(folders)
      .filter((id) => folders[id].deleted_at === undefined && depthOf(folders, id) > maxDepth)
      .sort((a, b) => depthOf(folders, a) - depthOf(folders, b) || a.localeCompare(b))[0];
    if (offender === undefined) {
      return;
    }
    folders[offender] = { ...folders[offender], parent_id: null };
  }
}

function restoreHome(folders: Record<string, FolderEntry>, at: string): void {
  const home = folders[HOME_FOLDER_ID];
  if (home === undefined) {
    folders[HOME_FOLDER_ID] = { name: HOME_FOLDER_NAME, parent_id: null, position: 0, updated_at: at };
    return;
  }
  if (home.deleted_at !== undefined || home.parent_id !== null) {
    folders[HOME_FOLDER_ID] = {
      name: home.name,
      parent_id: null,
      position: home.position,
      updated_at: home.updated_at,
    };
  }
}

export function repairFolderManifest(manifest: FolderManifest, rules: FolderRules, at = new Date()): FolderManifest {
  const folders: Record<string, FolderEntry> = { ...manifest.folders };
  for (const [id, folder] of Object.entries(folders)) {
    if (folder.parent_id !== null && !has(folders, folder.parent_id)) {
      folders[id] = { ...folder, parent_id: null };
    }
  }
  breakCycles(folders);
  if (rules.home) {
    restoreHome(folders, at.toISOString());
  }
  cascadeDeletions(folders);
  liftTooDeep(folders, rules.maxDepth);

  const items: Record<string, ItemPlacement> = {};
  for (const [id, placement] of Object.entries(manifest.items)) {
    items[id] =
      placement.folder_id !== null && !has(folders, placement.folder_id)
        ? { ...placement, folder_id: null }
        : placement;
  }
  return validateFolderManifest({ v: FOLDER_MANIFEST_VERSION, folders, items }, rules);
}

export function mergeFolderManifests(
  stored: FolderManifest,
  local: FolderManifest,
  rules: FolderRules,
  at = new Date(),
): FolderManifest {
  return repairFolderManifest(
    {
      v: FOLDER_MANIFEST_VERSION,
      folders: mergeRecords(stored.folders, local.folders),
      items: mergeRecords(stored.items, local.items),
    },
    rules,
    at,
  );
}

function requireLiveFolder(manifest: FolderManifest, id: string): FolderEntry {
  if (!isLive(manifest.folders, id)) {
    throw new FolderEditError('unknown-folder', id);
  }
  return manifest.folders[id];
}

function requireName(name: string, id?: string): string {
  const trimmed = name.trim();
  if (!isFolderName(trimmed)) {
    throw new FolderEditError('bad-name', id);
  }
  return trimmed;
}

function nextPosition(manifest: FolderManifest, parentId: string | null): number {
  let highest = -1;
  for (const folder of Object.values(manifest.folders)) {
    if (folder.parent_id === parentId && folder.deleted_at === undefined) {
      highest = Math.max(highest, folder.position);
    }
  }
  return highest + 1;
}

function isWithin(folders: Record<string, FolderEntry>, id: string, ancestorId: string): boolean {
  let current: string | null = id;
  while (current !== null && has(folders, current)) {
    if (current === ancestorId) {
      return true;
    }
    current = folders[current].parent_id;
  }
  return false;
}

export function createFolder(
  folder: { id?: string; name: string; parentId?: string | null },
  at = new Date(),
): FolderEdit {
  const id = folder.id ?? crypto.randomUUID();
  return (manifest, rules) => {
    if (id === '' || has(manifest.folders, id)) {
      throw new FolderEditError('folder-exists', id);
    }
    const name = requireName(folder.name, id);
    const parentId = folder.parentId ?? null;
    if (parentId !== null) {
      requireLiveFolder(manifest, parentId);
    }
    const depth = parentId === null ? 1 : depthOf(manifest.folders, parentId) + 1;
    if (depth > rules.maxDepth) {
      throw new FolderEditError('too-deep', id);
    }
    return {
      ...manifest,
      folders: {
        ...manifest.folders,
        [id]: {
          name,
          parent_id: parentId,
          position: nextPosition(manifest, parentId),
          updated_at: at.toISOString(),
        },
      },
    };
  };
}

export function renameFolder(id: string, name: string, at = new Date()): FolderEdit {
  return (manifest) => {
    const current = requireLiveFolder(manifest, id);
    const trimmed = requireName(name, id);
    if (current.name === trimmed) {
      return manifest;
    }
    return {
      ...manifest,
      folders: { ...manifest.folders, [id]: { ...current, name: trimmed, updated_at: at.toISOString() } },
    };
  };
}

export function moveFolder(
  id: string,
  target: { parentId: string | null; position?: number },
  at = new Date(),
): FolderEdit {
  return (manifest, rules) => {
    const current = requireLiveFolder(manifest, id);
    const parentId = target.parentId;
    if (id === HOME_FOLDER_ID && rules.home && parentId !== null) {
      throw new FolderEditError('home-is-fixed', id);
    }
    if (parentId !== null) {
      requireLiveFolder(manifest, parentId);
      if (isWithin(manifest.folders, parentId, id)) {
        throw new FolderEditError('into-itself', id);
      }
    }
    const parentDepth = parentId === null ? 0 : depthOf(manifest.folders, parentId);
    if (parentDepth + subtreeHeight(manifest.folders, id) > rules.maxDepth) {
      throw new FolderEditError('too-deep', id);
    }
    const position =
      target.position ?? (current.parent_id === parentId ? current.position : nextPosition(manifest, parentId));
    if (current.parent_id === parentId && current.position === position) {
      return manifest;
    }
    return {
      ...manifest,
      folders: {
        ...manifest.folders,
        [id]: { ...current, parent_id: parentId, position, updated_at: at.toISOString() },
      },
    };
  };
}

export function deleteFolder(id: string, at = new Date()): FolderEdit {
  return (manifest, rules) => {
    requireLiveFolder(manifest, id);
    if (id === HOME_FOLDER_ID && rules.home) {
      throw new FolderEditError('home-is-fixed', id);
    }
    const stamp = at.toISOString();
    const folders = { ...manifest.folders };
    for (const [folderId, folder] of Object.entries(folders)) {
      if (folder.deleted_at === undefined && isWithin(folders, folderId, id)) {
        folders[folderId] = { ...folder, updated_at: stamp, deleted_at: stamp };
      }
    }
    return { ...manifest, folders };
  };
}

export function placeItem(itemId: string, folderId: string | null, at = new Date()): FolderEdit {
  return (manifest) => {
    if (folderId !== null) {
      requireLiveFolder(manifest, folderId);
    }
    if (manifest.items[itemId]?.folder_id === folderId) {
      return manifest;
    }
    return {
      ...manifest,
      items: { ...manifest.items, [itemId]: { folder_id: folderId, updated_at: at.toISOString() } },
    };
  };
}

export function forgetItems(itemIds: Iterable<string>): FolderEdit {
  return (manifest) => {
    const items = { ...manifest.items };
    let changed = false;
    for (const id of itemIds) {
      if (Object.hasOwn(items, id)) {
        delete items[id];
        changed = true;
      }
    }
    return changed ? { ...manifest, items } : manifest;
  };
}

function byPosition(a: Folder, b: Folder): number {
  return a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function liveFolders(manifest: FolderManifest): Folder[] {
  return Object.entries(manifest.folders)
    .filter(([, folder]) => folder.deleted_at === undefined)
    .map(([id, folder]) => ({ id, ...folder }))
    .sort(byPosition);
}

export function childFolders(manifest: FolderManifest, parentId: string | null): Folder[] {
  return liveFolders(manifest).filter((folder) => folder.parent_id === parentId);
}

export function folderPath(manifest: FolderManifest, id: string): Folder[] {
  const path: Folder[] = [];
  let current: string | null = id;
  while (current !== null && isLive(manifest.folders, current) && path.length < Object.keys(manifest.folders).length) {
    path.unshift({ id: current, ...manifest.folders[current] });
    current = manifest.folders[current].parent_id;
  }
  return path;
}

export function folderOf(manifest: FolderManifest, itemId: string, rules: FolderRules): string | null {
  const assigned = manifest.items[itemId]?.folder_id ?? null;
  if (assigned !== null && isLive(manifest.folders, assigned)) {
    return assigned;
  }
  return rules.home ? HOME_FOLDER_ID : null;
}

export function itemsIn(
  manifest: FolderManifest,
  folderId: string | null,
  itemIds: Iterable<string>,
  rules: FolderRules,
): string[] {
  return [...itemIds].filter((itemId) => folderOf(manifest, itemId, rules) === folderId);
}
