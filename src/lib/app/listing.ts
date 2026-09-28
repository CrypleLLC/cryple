import type { FileRecord } from '@/lib/files';

export const LISTING_EMPTY_CELL = '—';

export function newestCreatedFirst<T extends { createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return 0;
    }
    if (a.createdAt === '') {
      return -1;
    }
    if (b.createdAt === '') {
      return 1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function listingDateLabel(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  if (at === '' || Number.isNaN(date.getTime())) {
    return LISTING_EMPTY_CELL;
  }

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function dateAndTimeLabels(at: string): { date: string; time: string } {
  const moment = new Date(at);
  if (at === '' || Number.isNaN(moment.getTime())) {
    return { date: LISTING_EMPTY_CELL, time: '' };
  }

  return {
    date: moment.toLocaleDateString(),
    time: moment.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}

export function actionsHeader(...labels: (string | false)[]): string {
  return labels.filter((label): label is string => label !== false).join(' | ');
}

export const FILE_STATUS_SHORT = {
  repairing: 'Being repaired',
  unfinished: 'Upload unfinished',
  replicated: 'Replicated',
  replicaFailed: 'Replica missing',
  replicating: 'Replicating…',
} as const;

export function fileStatusShortLabel(file: Pick<FileRecord, 'r2_state' | 'gcs_state'>): string {
  if (file.r2_state === 'missing') {
    return FILE_STATUS_SHORT.repairing;
  }
  if (file.r2_state !== 'ok') {
    return FILE_STATUS_SHORT.unfinished;
  }

  switch (file.gcs_state) {
    case 'ok':
      return FILE_STATUS_SHORT.replicated;
    case 'failed':
      return FILE_STATUS_SHORT.replicaFailed;
    default:
      return FILE_STATUS_SHORT.replicating;
  }
}

export const FOLDER_TYPE_LABEL = 'Folder';
export const DOCUMENT_TYPE_LABEL = 'Document';

export const DOCUMENT_STATUS = {
  saved: 'Saved',
  unreadable: 'Could not be decrypted',
} as const;

export function documentStatusLabel(readable: boolean): string {
  return readable ? DOCUMENT_STATUS.saved : DOCUMENT_STATUS.unreadable;
}
