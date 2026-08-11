import { noteCharacterCount, MAX_NOTE_CHARACTERS, type NoteRecord } from '@/lib/notes';
import { blockPlainText, parseBlocks, toDisplayText, toPlainText } from '@/lib/note-format';

export const UNTITLED_NOTE = 'Untitled note';
export const UNREADABLE_NOTE_TITLE = 'Unreadable note';
export const NOTE_TITLE_MAX_CHARACTERS = 60;
export const NOTE_THUMBNAIL_MAX_CHARACTERS = 420;

const ELLIPSIS = '…';

function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit
    ? text
    : `${characters.slice(0, limit).join('').trimEnd()}${ELLIPSIS}`;
}

export function noteTitle(text: string): string {
  const first = parseBlocks(text)
    .map((block) => blockPlainText(block).trim())
    .find((line) => line.length > 0);

  return first === undefined ? UNTITLED_NOTE : truncate(first, NOTE_TITLE_MAX_CHARACTERS);
}

export function noteThumbnail(text: string): string {
  const collapsed = toDisplayText(text).replace(/\n{3,}/g, '\n\n').trim();
  return truncate(collapsed, NOTE_THUMBNAIL_MAX_CHARACTERS);
}

export function noteCharactersLeft(text: string): number {
  return MAX_NOTE_CHARACTERS - noteCharacterCount(text);
}

export function isNoteWithinLimit(text: string): boolean {
  return noteCharactersLeft(text) >= 0;
}

export function isNoteEmpty(text: string): boolean {
  return toPlainText(text).trim().length === 0;
}

export function isNoteSavable(text: string, saved: string | undefined): boolean {
  return !isNoteEmpty(text) && text !== saved && isNoteWithinLimit(text);
}

export const NOTE_AUTOSAVE_DELAY_MS = 2000;

export type NoteSaveState = 'blank' | 'emptied' | 'over-limit' | 'saving' | 'saved' | 'editing';

export const NOTE_SAVE_LABELS: Record<NoteSaveState, string> = {
  blank: '',
  emptied: 'Nothing to save — use Delete to remove this note',
  'over-limit': 'Too long to save',
  saving: 'Saving…',
  saved: 'Saved',
  editing: 'Unsaved changes',
};

export function noteSaveState(input: {
  draft: string;
  saved: string | undefined;
  saving: boolean;
}): NoteSaveState {
  const { draft, saved, saving } = input;

  if (!isNoteWithinLimit(draft)) {
    return 'over-limit';
  }
  if (saving) {
    return 'saving';
  }
  if (isNoteEmpty(draft)) {
    return saved === undefined ? 'blank' : 'emptied';
  }
  return draft === saved ? 'saved' : 'editing';
}

export function toggleNoteSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((candidate) => candidate !== id)
    : [...selected, id];
}

export function retainSelectable(selected: readonly string[], present: readonly string[]): string[] {
  const ids = new Set(present);
  return selected.filter((id) => ids.has(id));
}

export function noteCountLabel(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`;
}

export function batchDeleteConfirmation(count: number): string {
  const notes = count === 1 ? 'this note' : `these ${count} notes`;
  const them = count === 1 ? 'it' : 'them';
  return `Deleting ${notes} is permanent, and it also removes ${them} from anyone who was set to inherit ${them}.`;
}

export function batchDeleteSummary(result: {
  requested: number;
  deleted: number;
}): string | undefined {
  const missing = result.requested - result.deleted;
  if (missing <= 0) {
    return undefined;
  }

  const were = missing === 1 ? 'was' : 'were';
  if (result.deleted === 0) {
    return `${noteCountLabel(missing)} ${were} already gone. The list is now up to date.`;
  }
  return `Deleted ${result.deleted} of ${result.requested} — ${noteCountLabel(missing)} ${were} already gone.`;
}

export interface OpenedNote {
  record: NoteRecord;
  plaintext?: string;
}

export interface NoteTile {
  id: string;
  title: string;
  thumbnail: string;
  bytes: number;
  version: string;
  createdAt: string;
  updatedAt: string;
  readable: boolean;
}

export function buildNoteTiles(opened: readonly OpenedNote[]): NoteTile[] {
  return opened
    .map((entry) => toNoteTile(entry))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function toNoteTile({ record, plaintext }: OpenedNote): NoteTile {
  const tile = {
    id: record.id,
    bytes: new TextEncoder().encode(record.ciphertext).length,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };

  if (plaintext === undefined) {
    return { ...tile, title: UNREADABLE_NOTE_TITLE, thumbnail: '', readable: false };
  }

  return {
    ...tile,
    title: noteTitle(plaintext),
    thumbnail: noteThumbnail(plaintext),
    readable: true,
  };
}
