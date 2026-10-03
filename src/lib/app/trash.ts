import type { TrashEntry, TrashKind } from '@/lib/trash';

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

export function deleteActionLabel(retentionDays: number): string {
  return retentionDays > 0 ? 'Move to Trash' : 'Delete permanently';
}

export const TRASH_COPY = {
  title: 'Trash',
  empty: 'The Trash is empty.',
  restore: 'Restore',
  restoring: 'Restoring…',
  purge: 'Delete for good',
  purging: 'Deleting…',
  emptyTrash: 'Empty the Trash',
  selectAll: 'Select all',
  unreadable: 'Some of the Trash could not be read. Try again in a moment.',
  restoredOverQuota:
    'There is not enough space to restore that. Free some space in the Drive, or restore fewer files.',
  purgeTitle: (count: number) => (count === 1 ? 'Delete this for good?' : `Delete ${count} items for good?`),
  purgeWarning:
    'This cannot be undone. Only this account holds the keys, so nobody — including Cryple — can ' +
    'bring it back.',
  emptyTitle: 'Empty the Trash?',
  emptyWarning:
    'Everything in the Trash is deleted for good. This cannot be undone, by you or by anyone at Cryple.',
  fullDeviceOnly: 'Only a full device can delete from the Trash for good.',
} as const;

export function trashRetentionNotice(retentionDays: number): string {
  if (retentionDays <= 0) {
    return (
      'Your account does not keep deleted documents and files: they are deleted for good shortly after ' +
      'you delete them, so nothing waits here.'
    );
  }
  return (
    `Deleted documents and Drive files stay here for ${daysLabel(retentionDays)}, then are deleted for ` +
    'good. Restoring puts them back where they were, or at the top if their folder is gone.'
  );
}

export const TRASH_KIND_LABELS: Record<TrashKind, string> = {
  folder: 'Folder',
  document: 'Document',
  file: 'File',
};

const UNREADABLE_NAMES: Record<TrashKind, string> = {
  folder: 'Unreadable folder',
  document: 'Untitled document',
  file: 'Unreadable file',
};

export function trashEntryName(entry: Pick<TrashEntry, 'kind' | 'name'>): string {
  const name = entry.name?.trim();
  return name === undefined || name === '' ? UNREADABLE_NAMES[entry.kind] : name;
}

export function trashEntryDetail(entry: Pick<TrashEntry, 'kind' | 'scope' | 'itemCount'>): string {
  const place = entry.scope === 'documents' ? 'Documents' : 'Drive';
  if (entry.kind !== 'folder') {
    return `${TRASH_KIND_LABELS[entry.kind]} · ${place}`;
  }
  const count = entry.itemCount ?? 0;
  const things = entry.scope === 'documents' ? ['document', 'documents'] : ['file', 'files'];
  return `Folder · ${place} · ${count} ${count === 1 ? things[0] : things[1]}`;
}

export function daysLeft(deletedAt: string, retentionDays: number, now: Date = new Date()): number {
  const expires = Date.parse(deletedAt) + retentionDays * DAY_MS;
  return Math.max(0, Math.ceil((expires - now.getTime()) / DAY_MS));
}

export function trashExpiryLabel(deletedAt: string, retentionDays: number, now: Date = new Date()): string {
  const left = daysLeft(deletedAt, retentionDays, now);
  return left <= 0 ? 'Deleted for good today' : `Deleted for good in ${daysLabel(left)}`;
}

export function trashSummary(restoredOrPurged: number, verb: 'restored' | 'deleted'): string {
  return `${restoredOrPurged === 1 ? '1 item' : `${restoredOrPurged} items`} ${verb}.`;
}
