import { formatBytes } from './vault';
import type { FileRecord, StorageUsage, UploadProgress } from '@/lib/files';

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

export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'archive'
  | 'document'
  | 'sheet'
  | 'slides'
  | 'code'
  | 'text'
  | 'other';

const DOCUMENT_TYPES = /msword|wordprocessingml|opendocument\.text|rtf|epub/;
const SHEET_TYPES = /ms-excel|spreadsheetml|opendocument\.spreadsheet|csv/;
const SLIDES_TYPES = /ms-powerpoint|presentationml|opendocument\.presentation/;
const ARCHIVE_TYPES = /zip|tar|gzip|bzip|rar|7z-compressed|x-xz/;
const CODE_TYPES = /javascript|typescript|json|xml|x-sh|x-python|x-c|x-java|yaml|sql|wasm/;

export function fileKind(mime: string): FileKind {
  const type = mime.toLowerCase();

  if (type === 'application/pdf') return 'pdf';
  if (DOCUMENT_TYPES.test(type)) return 'document';
  if (SHEET_TYPES.test(type)) return 'sheet';
  if (SLIDES_TYPES.test(type)) return 'slides';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (ARCHIVE_TYPES.test(type)) return 'archive';
  if (CODE_TYPES.test(type)) return 'code';
  if (type.startsWith('text/')) return 'text';

  return 'other';
}

export const FILE_EXTENSION_MAX_CHARACTERS = 4;

export function fileExtension(name: string): string {
  const base = name.trim().split('/').pop() ?? '';
  const cut = base.lastIndexOf('.');
  if (cut <= 0 || cut === base.length - 1) {
    return '';
  }

  const extension = base.slice(cut + 1);
  return /^[A-Za-z0-9]+$/.test(extension) &&
    extension.length <= FILE_EXTENSION_MAX_CHARACTERS
    ? extension.toUpperCase()
    : '';
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

export function fileCaption(status: string, trueBytes: number): string {
  return status === '' || status === REPLICATION_DONE ? formatBytes(trueBytes) : status;
}

export function isOpenable(file: Pick<FileRecord, 'r2_state'>): boolean {
  return file.r2_state === 'ok';
}

export function isResumable(file: Pick<FileRecord, 'r2_state'>): boolean {
  return file.r2_state === 'pending';
}

export interface StorageBar {
  usedLabel: string;
  quotaLabel: string;
  summary: string;
  uploadingSummary?: string;
  percent: number;
  reservedPercent: number;
  nearlyFull: boolean;
}

export const NEARLY_FULL_AT = 0.9;

function share(bytes: number, quota: number): number {
  if (quota <= 0) {
    return 0;
  }

  return Math.round(Math.min(100, (bytes / quota) * 100) * 10) / 10;
}

export function storageBar(usage: StorageUsage): StorageBar {
  const reserved = Math.max(0, usage.used_bytes - usage.stored_bytes);
  const percent = share(usage.stored_bytes, usage.quota_bytes);

  return {
    usedLabel: formatBytes(usage.stored_bytes),
    quotaLabel: formatBytes(usage.quota_bytes),
    summary: `${formatBytes(usage.stored_bytes)} of ${formatBytes(usage.quota_bytes)} used`,
    uploadingSummary:
      reserved === 0 ? undefined : `${formatBytes(reserved)} held by unfinished uploads`,
    percent,
    reservedPercent: Math.max(0, share(usage.used_bytes, usage.quota_bytes) - percent),
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

export function fileBatchDeleteConfirmation(count: number): string {
  const files = count === 1 ? 'this file' : `these ${count} files`;
  const them = count === 1 ? 'it' : 'them';
  return (
    `Deleting ${files} is permanent. Only this account holds the keys, so nobody — ` +
    `including Cryple — can restore ${them}. ${DELETED_SPACE_RETURNS}`
  );
}

export function fileBatchDeleteSummary(result: {
  requested: number;
  deleted: number;
}): string | undefined {
  const missing = result.requested - result.deleted;
  if (missing <= 0) {
    return undefined;
  }

  const were = missing === 1 ? 'was' : 'were';
  if (result.deleted === 0) {
    return `${fileCountLabel(missing)} ${were} already gone. The list is now up to date.`;
  }
  return `Deleted ${result.deleted} of ${result.requested} — ${fileCountLabel(missing)} ${were} already gone.`;
}

export function resumeHint(name: string, remembered: boolean): string {
  return remembered
    ? `Finish uploading ${fileName(name)} — this device still has the file`
    : `Finish uploading ${fileName(name)} — pick the same file again`;
}

export function toggleFileSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((candidate) => candidate !== id)
    : [...selected, id];
}

export function discardConfirmation(name: string): string {
  return (
    `Discarding ${fileName(name)} throws away an upload that never finished. Nothing was ` +
    'stored, so there is nothing to restore — and the space it was holding comes back at once.'
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

export function transferLabel(phase: UploadProgress['phase'], percent: number): string {
  return phase === 'completing' ? 'Finishing the upload…' : `Uploading… ${percent}%`;
}

export function uploadPercent(doneBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((doneBytes / totalBytes) * 100));
}
