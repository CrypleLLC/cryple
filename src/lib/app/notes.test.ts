import { describe, expect, it } from 'vitest';
import { MAX_NOTE_CHARACTERS, type NoteRecord } from '@/lib/notes';
import {
  batchDeleteConfirmation,
  batchDeleteSummary,
  buildNoteTiles,
  isNoteSavable,
  noteCountLabel,
  retainSelectable,
  toggleNoteSelection,
  isNoteWithinLimit,
  noteCharactersLeft,
  noteSaveState,
  noteThumbnail,
  noteTitle,
  NOTE_AUTOSAVE_DELAY_MS,
  NOTE_SAVE_LABELS,
  NOTE_THUMBNAIL_MAX_CHARACTERS,
  NOTE_TITLE_MAX_CHARACTERS,
  UNREADABLE_NOTE_TITLE,
  UNTITLED_NOTE,
  type OpenedNote,
} from './notes';

const ID_A = '0c892e57-93cf-423a-a9e9-fee5a9f87681';
const ID_B = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function record(id: string, updatedAt: string): NoteRecord {
  return {
    id,
    ciphertext: 'AXh4eHh4eHh4eHh4Y2lwaGVy',
    wrapped_dek: 'd3JhcHBlZA==',
    version: 'v1',
    created_at: '2026-08-01T12:00:00Z',
    updated_at: updatedAt,
  };
}

describe('noteTitle', () => {
  it('names the file after the first non-empty line', () => {
    expect(noteTitle('Letter to Ana\n\nHello,')).toBe('Letter to Ana');
  });

  it('skips leading blank lines rather than naming the note after them', () => {
    expect(noteTitle('\n\n   \nSafe combination\nbody')).toBe('Safe combination');
  });

  it('falls back for a note that is empty or only whitespace', () => {
    expect(noteTitle('')).toBe(UNTITLED_NOTE);
    expect(noteTitle('   \n\t\n')).toBe(UNTITLED_NOTE);
  });

  it('truncates a long first line instead of letting it break the grid', () => {
    const title = noteTitle('x'.repeat(200));
    expect(Array.from(title)).toHaveLength(NOTE_TITLE_MAX_CHARACTERS + 1);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('noteThumbnail', () => {
  it('shows the real content, line breaks included', () => {
    expect(noteThumbnail('Title\nfirst line\nsecond line')).toBe('Title\nfirst line\nsecond line');
  });

  it('collapses long runs of blank lines so the miniature is not mostly empty', () => {
    expect(noteThumbnail('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('truncates past the thumbnail budget', () => {
    const thumbnail = noteThumbnail('y'.repeat(NOTE_THUMBNAIL_MAX_CHARACTERS + 50));
    expect(Array.from(thumbnail)).toHaveLength(NOTE_THUMBNAIL_MAX_CHARACTERS + 1);
    expect(thumbnail.endsWith('…')).toBe(true);
  });
});

describe('the character budget', () => {
  it('reports what is left against the 5000-character product limit', () => {
    expect(noteCharactersLeft('')).toBe(MAX_NOTE_CHARACTERS);
    expect(noteCharactersLeft('abc')).toBe(MAX_NOTE_CHARACTERS - 3);
  });

  it('goes negative rather than clamping, so the editor can say how far over it is', () => {
    expect(noteCharactersLeft('x'.repeat(MAX_NOTE_CHARACTERS + 7))).toBe(-7);
    expect(isNoteWithinLimit('x'.repeat(MAX_NOTE_CHARACTERS))).toBe(true);
    expect(isNoteWithinLimit('x'.repeat(MAX_NOTE_CHARACTERS + 1))).toBe(false);
  });
});

describe('isNoteSavable', () => {
  it('refuses an empty or whitespace-only note', () => {
    expect(isNoteSavable('', undefined)).toBe(false);
    expect(isNoteSavable('   \n ', undefined)).toBe(false);
  });

  it('refuses a note identical to what is already stored', () => {
    expect(isNoteSavable('same', 'same')).toBe(false);
    expect(isNoteSavable('changed', 'same')).toBe(true);
  });

  it('refuses an over-limit note', () => {
    expect(isNoteSavable('x'.repeat(MAX_NOTE_CHARACTERS + 1), undefined)).toBe(false);
  });

  it('allows a first save of a brand-new note', () => {
    expect(isNoteSavable('a letter', undefined)).toBe(true);
  });
});

describe('noteSaveState', () => {
  const state = (draft: string, saved: string | undefined, saving = false) =>
    noteSaveState({ draft, saved, saving });

  it('says nothing at all about an untouched blank note', () => {
    expect(state('', undefined)).toBe('blank');
    expect(NOTE_SAVE_LABELS.blank).toBe('');
  });

  it('reports unsaved changes while the autosave timer is still counting down', () => {
    expect(state('a letter', undefined)).toBe('editing');
    expect(state('edited', 'stored')).toBe('editing');
  });

  it('reports saved once the draft matches what was persisted', () => {
    expect(state('stored', 'stored')).toBe('saved');
  });

  it('reports saving while a write is in flight, whatever the draft says', () => {
    expect(state('edited', 'stored', true)).toBe('saving');
    expect(state('stored', 'stored', true)).toBe('saving');
  });

  it('lets over-limit outrank saving, because it is the state the user must act on', () => {
    const tooLong = 'x'.repeat(MAX_NOTE_CHARACTERS + 1);
    expect(state(tooLong, undefined)).toBe('over-limit');
    expect(state(tooLong, 'stored', true)).toBe('over-limit');
  });

  it('distinguishes a never-written blank note from one the user emptied', () => {
    expect(state('', undefined)).toBe('blank');
    expect(state('', 'stored')).toBe('emptied');
    expect(state('   \n ', 'stored')).toBe('emptied');
  });

  it('never leaves a state without a label, so the indicator cannot render undefined', () => {
    for (const key of ['blank', 'emptied', 'over-limit', 'saving', 'saved', 'editing'] as const) {
      expect(NOTE_SAVE_LABELS[key]).toBeTypeOf('string');
    }
  });

  it('agrees with isNoteSavable on every state autosave is allowed to write in', () => {
    const cases: [string, string | undefined][] = [
      ['', undefined],
      ['', 'stored'],
      ['x'.repeat(MAX_NOTE_CHARACTERS + 1), undefined],
      ['stored', 'stored'],
      ['edited', 'stored'],
      ['a letter', undefined],
    ];

    for (const [draft, saved] of cases) {
      expect(isNoteSavable(draft, saved)).toBe(noteSaveState({ draft, saved, saving: false }) === 'editing');
    }
  });
});

describe('the autosave delay', () => {
  it('waits two seconds of inactivity', () => {
    expect(NOTE_AUTOSAVE_DELAY_MS).toBe(2000);
  });
});

describe('selection', () => {
  it('adds and removes without mutating the array it was given', () => {
    const start: string[] = [];
    const one = toggleNoteSelection(start, ID_A);
    const two = toggleNoteSelection(one, ID_B);

    expect(start).toEqual([]);
    expect(one).toEqual([ID_A]);
    expect(two).toEqual([ID_A, ID_B]);
    expect(toggleNoteSelection(two, ID_A)).toEqual([ID_B]);
  });

  it('drops ids that are no longer in the list, so a stale tick cannot delete a note', () => {
    expect(retainSelectable([ID_A, ID_B], [ID_B])).toEqual([ID_B]);
    expect(retainSelectable([ID_A], [])).toEqual([]);
    expect(retainSelectable([], [ID_A])).toEqual([]);
  });

  it('counts notes in words the toolbar can print directly', () => {
    expect(noteCountLabel(0)).toBe('0 notes');
    expect(noteCountLabel(1)).toBe('1 note');
    expect(noteCountLabel(7)).toBe('7 notes');
  });
});

describe('batch delete copy', () => {
  it('names the inheritance consequence, singular and plural', () => {
    expect(batchDeleteConfirmation(1)).toContain('this note');
    expect(batchDeleteConfirmation(1)).toContain('inherit it');
    expect(batchDeleteConfirmation(3)).toContain('these 3 notes');
    expect(batchDeleteConfirmation(3)).toContain('inherit them');
  });

  it('stays silent when the server deleted everything asked for', () => {
    expect(batchDeleteSummary({ requested: 3, deleted: 3 })).toBe(undefined);
    expect(batchDeleteSummary({ requested: 1, deleted: 1 })).toBe(undefined);
  });

  it('explains a shortfall as already gone, not as a failure to retry', () => {
    const summary = batchDeleteSummary({ requested: 3, deleted: 1 });
    expect(summary).toContain('Deleted 1 of 3');
    expect(summary).toContain('2 notes were already gone');
    expect(summary).not.toMatch(/try again/i);
  });

  it('agrees the verb with the count', () => {
    expect(batchDeleteSummary({ requested: 2, deleted: 1 })).toContain('1 note was already gone');
    expect(batchDeleteSummary({ requested: 3, deleted: 1 })).toContain('2 notes were already gone');
  });

  it('does not claim a partial success when nothing matched', () => {
    const summary = batchDeleteSummary({ requested: 2, deleted: 0 });
    expect(summary).toContain('2 notes were already gone');
    expect(summary).not.toContain('Deleted 0');
  });
});

describe('buildNoteTiles', () => {
  it('orders the newest note first', () => {
    const tiles = buildNoteTiles([
      { record: record(ID_A, '2026-08-01T12:00:00Z'), plaintext: 'older' },
      { record: record(ID_B, '2026-08-09T12:00:00Z'), plaintext: 'newer' },
    ]);

    expect(tiles.map((tile) => tile.id)).toEqual([ID_B, ID_A]);
  });

  it('marks a note it could not decrypt instead of dropping it', () => {
    const opened: OpenedNote[] = [{ record: record(ID_A, '2026-08-01T12:00:00Z') }];
    const [tile] = buildNoteTiles(opened);

    expect(tile.readable).toBe(false);
    expect(tile.title).toBe(UNREADABLE_NOTE_TITLE);
    expect(tile.thumbnail).toBe('');
  });

  it('carries the metadata the file view renders', () => {
    const [tile] = buildNoteTiles([
      { record: record(ID_A, '2026-08-05T09:30:00Z'), plaintext: 'Title\nbody' },
    ]);

    expect(tile).toMatchObject({
      id: ID_A,
      title: 'Title',
      thumbnail: 'Title\nbody',
      version: 'v1',
      createdAt: '2026-08-01T12:00:00Z',
      updatedAt: '2026-08-05T09:30:00Z',
      readable: true,
    });
    expect(tile.bytes).toBeGreaterThan(0);
  });
});
