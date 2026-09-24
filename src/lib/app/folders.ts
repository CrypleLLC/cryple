import {
  folderOf,
  HOME_FOLDER_ID,
  liveFolders,
  MAX_FOLDER_NAME_LENGTH,
  type FolderManifest,
  type FolderManifestProblem,
  type FolderRules,
} from '@/lib/folders';

export interface FolderTab {
  id: string;
  name: string;
  count: number;
  home: boolean;
}

export interface FolderNouns {
  one: string;
  many: string;
}

export const SECRET_NOUNS: FolderNouns = { one: 'secret', many: 'secrets' };
export const NOTE_NOUNS: FolderNouns = { one: 'note', many: 'notes' };

export function countOf(count: number, nouns: FolderNouns): string {
  return `${count} ${count === 1 ? nouns.one : nouns.many}`;
}

export function buildFolderTabs(
  manifest: FolderManifest,
  itemIds: readonly string[],
  rules: FolderRules,
): FolderTab[] {
  const counts = new Map<string, number>();
  for (const itemId of itemIds) {
    const folderId = folderOf(manifest, itemId, rules) ?? HOME_FOLDER_ID;
    counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
  }
  return liveFolders(manifest)
    .filter((folder) => folder.parent_id === null)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      count: counts.get(folder.id) ?? 0,
      home: folder.id === HOME_FOLDER_ID,
    }))
    .sort((a, b) => Number(b.home) - Number(a.home));
}

export function itemsInTab<T>(
  manifest: FolderManifest,
  tabId: string,
  items: readonly T[],
  idOf: (item: T) => string,
  rules: FolderRules,
): T[] {
  return items.filter((item) => (folderOf(manifest, idOf(item), rules) ?? HOME_FOLDER_ID) === tabId);
}

export function activeTabOf(tabs: readonly FolderTab[], wanted: string | undefined): string {
  return tabs.find((tab) => tab.id === wanted)?.id ?? tabs[0]?.id ?? HOME_FOLDER_ID;
}

export function tabNameProblem(name: string, tabs: readonly FolderTab[], renaming?: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Give the tab a name.';
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    return `A tab name is at most ${MAX_FOLDER_NAME_LENGTH} characters.`;
  }
  const clash = tabs.find(
    (tab) => tab.id !== renaming && tab.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  return clash === undefined ? undefined : `There is already a tab called “${clash.name}”.`;
}

export function tabDeleteConfirmation(tab: FolderTab, nouns: FolderNouns): string {
  if (tab.count === 0) {
    return `Delete the tab “${tab.name}”? It is empty, so nothing else is removed.`;
  }
  return `Deleting “${tab.name}” also deletes the ${countOf(tab.count, nouns)} in it, permanently.`;
}

export function tabDeleteRefusal(tab: FolderTab, fullDevice: boolean, nouns: FolderNouns): string | undefined {
  if (tab.home) {
    return 'This tab is where everything without a tab lives, so it cannot be deleted. You can rename it.';
  }
  if (tab.count > 0 && !fullDevice) {
    return `Only a full device can delete ${nouns.many}. Move them out of “${tab.name}” first, or delete it from a full device.`;
  }
  return undefined;
}

const INVALID_TREE_COPY: Record<FolderManifestProblem, string> = {
  cycle: 'the tabs refer to each other in a loop',
  'too-deep': 'a tab is nested inside another',
  'unknown-parent': 'a tab refers to one that does not exist',
  'deleted-parent': 'a tab sits inside a deleted one',
  'missing-home': 'the main tab is missing',
  'unknown-folder': 'an item is filed in a tab that never existed',
  malformed: 'the stored tabs do not decode',
  'bad-name': 'a tab has no usable name',
  'unknown-version': 'the stored tabs were written by a newer version of Cryple',
};

export function invalidTabsMessage(problem: FolderManifestProblem): string {
  return `Your tabs could not be shown safely: ${INVALID_TREE_COPY[problem]}. Everything is listed in one place until the tabs are reset. Resetting keeps every item and only forgets the tabs.`;
}

export const DOCUMENT_NOUNS: FolderNouns = { one: 'document', many: 'documents' };
export const FILE_NOUNS: FolderNouns = { one: 'file', many: 'files' };

export function folderNameProblem(
  name: string,
  siblings: readonly { id: string; name: string | undefined }[],
  renaming?: string,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Give the folder a name.';
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    return `A folder name is at most ${MAX_FOLDER_NAME_LENGTH} characters.`;
  }
  const clash = siblings.find(
    (folder) =>
      folder.id !== renaming && folder.name?.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  return clash === undefined ? undefined : `There is already a folder called “${clash.name}” here.`;
}

export function folderDeleteConfirmation(name: string, subfolders: number, nouns: FolderNouns): string {
  const inside =
    subfolders === 0
      ? `every ${nouns.one} in it`
      : `the ${subfolders === 1 ? 'folder' : `${subfolders} folders`} inside it and every ${nouns.one} they hold`;
  return `Deleting “${name}” also deletes ${inside}, permanently.`;
}

export function folderDeleteSummary(result: { folders: number; items: number }, nouns: FolderNouns): string {
  const folders = result.folders === 1 ? '1 folder' : `${result.folders} folders`;
  return `Deleted ${folders} and ${countOf(result.items, nouns)}.`;
}

export function folderMoveProblem(code: 'FOLDER_TOO_DEEP' | 'FOLDER_INTO_ITSELF'): string {
  return code === 'FOLDER_TOO_DEEP'
    ? 'Folders go at most 8 levels deep, and that move would go deeper.'
    : 'A folder cannot go inside itself or one of its own folders.';
}

export const UNREADABLE_FOLDER = 'Unreadable folder';
export const INVALID_TREE_MESSAGE =
  'Your folders could not be shown safely: the tree the server returned does not hold together. Everything is listed at the top level instead.';
