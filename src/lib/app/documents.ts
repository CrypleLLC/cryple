import type { DocumentSummary } from '@/lib/documents';
import type { SyncStatus } from '@/lib/documents';

export const UNTITLED_DOCUMENT = 'Untitled document';
export const UNREADABLE_DOCUMENT_TITLE = 'Unreadable document';
export const DOCUMENT_TITLE_MAX_CHARACTERS = 80;
export const DOCUMENT_PREVIEW_MAX_CHARACTERS = 180;

const ELLIPSIS = '…';

function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit
    ? text
    : `${characters.slice(0, limit).join('').trimEnd()}${ELLIPSIS}`;
}

export function documentTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length === 0
    ? UNTITLED_DOCUMENT
    : truncate(trimmed, DOCUMENT_TITLE_MAX_CHARACTERS);
}

export function documentPreview(preview: string): string {
  const collapsed = preview.replace(/\s+/g, ' ').trim();
  return truncate(collapsed, DOCUMENT_PREVIEW_MAX_CHARACTERS);
}

export const SAVE_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: '',
  loading: 'Opening…',
  synced: 'All changes saved',
  saving: 'Saving…',
  offline: 'Offline — changes are kept on this device',
  error: 'Sync paused',
};

export function saveStatusLabel(status: SyncStatus, pending: number): string {
  if (status === 'offline' && pending > 0) {
    const changes = pending === 1 ? '1 change' : `${pending} changes`;
    return `Offline — ${changes} kept on this device`;
  }
  return SAVE_STATUS_LABELS[status];
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function editedLabel(updatedAt: string, now: Date = new Date()): string {
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) {
    return 'Edited recently';
  }

  const elapsed = now.getTime() - at.getTime();
  if (elapsed < MINUTE_MS) {
    return 'Edited just now';
  }
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `Edited ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `Edited ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  return `Edited ${at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: at.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })}`;
}

export interface DocumentTile {
  id: string;
  title: string;
  preview: string;
  edited: string;
  updatedAt: string;
  readable: boolean;
  pendingUpdates: number;
  failure?: string;
}

export function buildDocumentTiles(
  summaries: readonly DocumentSummary[],
  now: Date = new Date(),
): DocumentTile[] {
  return summaries
    .map((summary) => ({
      id: summary.id,
      title: summary.readable ? documentTitle(summary.title) : UNREADABLE_DOCUMENT_TITLE,
      preview: summary.readable ? documentPreview(summary.preview) : '',
      edited: editedLabel(summary.updatedAt, now),
      updatedAt: summary.updatedAt,
      readable: summary.readable,
      pendingUpdates: Math.max(summary.latestSeq - summary.snapshotSeq, 0),
      failure: summary.failure,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function documentCountLabel(count: number): string {
  return count === 1 ? '1 document' : `${count} documents`;
}

export function documentDeleteConfirmation(count: number): string {
  const documents = count === 1 ? 'this document' : `these ${count} documents`;
  const them = count === 1 ? 'it' : 'them';
  return `Deleting ${documents} is permanent, and it also removes ${them} from anyone who was set to inherit ${them}.`;
}

export function documentHref(id: string): string {
  return `/docs/${id}`;
}
