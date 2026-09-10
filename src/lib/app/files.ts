import { formatBytes } from './vault';
import type { FileRecord, StorageUsage } from '@/lib/files';

export const UNREADABLE_FILE_NAME = 'Unreadable file';
export const FILE_NAME_MAX_CHARACTERS = 80;

const ELLIPSIS = '…';

export function fileName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return UNREADABLE_FILE_NAME;
  }

  const characters = Array.from(trimmed);
  return characters.length <= FILE_NAME_MAX_CHARACTERS
    ? trimmed
    : `${characters.slice(0, FILE_NAME_MAX_CHARACTERS).join('').trimEnd()}${ELLIPSIS}`;
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'text' | 'other';

export function fileKind(mime: string): FileKind {
  const type = mime.toLowerCase();

  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('text/')) return 'text';
  if (/zip|tar|gzip|rar|7z-compressed/.test(type)) return 'archive';

  return 'other';
}

export const REPLICATION_PENDING = 'Saved. A second copy is made within a minute.';
export const REPLICATION_DONE = 'Saved, with a second copy.';
export const REPLICATION_FAILED = 'Saved. The second copy has not been made.';
export const PRIMARY_MISSING = 'This file is being repaired. It cannot be opened right now.';
export const UPLOAD_UNFINISHED = 'This upload never finished, so the file is not in your vault.';

export function replicationLabel(file: Pick<FileRecord, 'r2_state' | 'gcs_state'>): string {
  if (file.r2_state === 'missing') {
    return PRIMARY_MISSING;
  }
  if (file.r2_state !== 'ok') {
    return UPLOAD_UNFINISHED;
  }

  switch (file.gcs_state) {
    case 'ok':
      return REPLICATION_DONE;
    case 'failed':
      return REPLICATION_FAILED;
    default:
      return REPLICATION_PENDING;
  }
}

export function isOpenable(file: Pick<FileRecord, 'r2_state'>): boolean {
  return file.r2_state === 'ok';
}

export interface StorageBar {
  usedLabel: string;
  quotaLabel: string;
  summary: string;
  percent: number;
  nearlyFull: boolean;
}

export const NEARLY_FULL_AT = 0.9;

export function storageBar(usage: StorageUsage): StorageBar {
  const percent =
    usage.quota_bytes <= 0 ? 0 : Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100);

  return {
    usedLabel: formatBytes(usage.used_bytes),
    quotaLabel: formatBytes(usage.quota_bytes),
    summary: `${formatBytes(usage.used_bytes)} of ${formatBytes(usage.quota_bytes)} used`,
    percent: Math.round(percent * 10) / 10,
    nearlyFull: usage.quota_bytes > 0 && usage.used_bytes / usage.quota_bytes >= NEARLY_FULL_AT,
  };
}

export const DELETED_SPACE_RETURNS =
  'Space from a deleted file returns within a minute, once both copies are removed.';

export function fileDeleteConfirmation(name: string): string {
  return (
    `Deleting ${fileName(name)} is permanent. Only this account holds the key, so nobody — ` +
    `including Cryple — can restore it. ${DELETED_SPACE_RETURNS}`
  );
}

export function storageFullMessage(usage: StorageUsage, neededBytes: number): string {
  return (
    `This file needs ${formatBytes(neededBytes)} and only ${formatBytes(
      Math.max(0, usage.quota_bytes - usage.used_bytes),
    )} is free. ${DELETED_SPACE_RETURNS}`
  );
}

export interface FileTile {
  id: string;
  name: string;
  mime: string;
  kind: FileKind;
  sizeLabel: string;
  storedBytes: number;
  status: string;
  openable: boolean;
  readable: boolean;
  updatedAt: string;
}

export function fileCountLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

export function uploadPercent(doneBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((doneBytes / totalBytes) * 100));
}
