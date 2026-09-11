import { describe, expect, it } from 'vitest';
import type { DocumentSummary } from '@/lib/documents';
import {
  UNREADABLE_DOCUMENT_TITLE,
  UNTITLED_DOCUMENT,
  buildDocumentTiles,
  documentCountLabel,
  documentCountsLabel,
  DOCUMENT_THUMBNAIL_MAX_CHARACTERS,
  documentDeleteConfirmation,
  documentHref,
  documentThumbnail,
  documentPreview,
  documentTitle,
  editedLabel,
  saveStatusLabel,
} from './documents';

function summary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    title: 'Quarterly letter',
    preview: 'To whoever is reading this…',
    updatedAt: '2026-08-11T12:00:00Z',
    createdAt: '2026-08-01T12:00:00Z',
    latestSeq: 7,
    snapshotSeq: 3,
    revision: 2,
    readable: true,
    ...overrides,
  };
}

describe('document titles', () => {
  it('falls back when the title is blank', () => {
    expect(documentTitle('   ')).toBe(UNTITLED_DOCUMENT);
  });

  it('truncates a long title rather than wrapping the card', () => {
    expect(documentTitle('a'.repeat(200))).toHaveLength(81);
    expect(documentTitle('a'.repeat(200)).endsWith('…')).toBe(true);
  });

  it('collapses whitespace in a preview', () => {
    expect(documentPreview('one\n\n  two\tthree ')).toBe('one two three');
  });
});

describe('save status', () => {
  it('names the pending work while offline', () => {
    expect(saveStatusLabel('offline', 1)).toBe('Offline — 1 change kept on this device');
    expect(saveStatusLabel('offline', 3)).toBe('Offline — 3 changes kept on this device');
  });

  it('reads as settled once everything is pushed', () => {
    expect(saveStatusLabel('synced', 0)).toBe('All changes saved');
    expect(saveStatusLabel('saving', 1)).toBe('Saving…');
  });
});

describe('edited labels', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('reads relatively inside a day', () => {
    expect(editedLabel('2026-08-11T11:59:30Z', now)).toBe('Edited just now');
    expect(editedLabel('2026-08-11T11:55:00Z', now)).toBe('Edited 5 minutes ago');
    expect(editedLabel('2026-08-11T11:00:00Z', now)).toBe('Edited 1 hour ago');
    expect(editedLabel('2026-08-11T08:00:00Z', now)).toBe('Edited 4 hours ago');
  });

  it('falls back to a date beyond a day', () => {
    expect(editedLabel('2026-08-01T12:00:00Z', now)).toMatch(/^Edited /);
    expect(editedLabel('2026-08-01T12:00:00Z', now)).not.toMatch(/ago/);
  });

  it('survives an unparseable timestamp', () => {
    expect(editedLabel('not a date', now)).toBe('Edited recently');
  });
});

describe('document tiles', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('sorts newest first', () => {
    const tiles = buildDocumentTiles(
      [
        summary({ id: 'older', updatedAt: '2026-08-01T12:00:00Z' }),
        summary({ id: 'newer', updatedAt: '2026-08-10T12:00:00Z' }),
      ],
      now,
    );

    expect(tiles.map((tile) => tile.id)).toEqual(['newer', 'older']);
  });

  it('marks an undecryptable document without inventing a preview', () => {
    const [tile] = buildDocumentTiles([summary({ readable: false, title: '', preview: '' })], now);

    expect(tile.title).toBe(UNREADABLE_DOCUMENT_TITLE);
    expect(tile.preview).toBe('');
    expect(tile.readable).toBe(false);
  });

  it('reports how much log sits above the snapshot', () => {
    const [tile] = buildDocumentTiles([summary({ latestSeq: 7, snapshotSeq: 3 })], now);
    expect(tile.pendingUpdates).toBe(4);
  });

  it('never reports negative pending work after a sequence restart', () => {
    const [tile] = buildDocumentTiles([summary({ latestSeq: 1, snapshotSeq: 9 })], now);
    expect(tile.pendingUpdates).toBe(0);
  });
});

describe('links and counts', () => {
  it('points at the document route', () => {
    expect(documentHref('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      '/docs/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );
  });

  it('pluralizes the count', () => {
    expect(documentCountLabel(1)).toBe('1 document');
    expect(documentCountLabel(4)).toBe('4 documents');
  });
});

describe('document counts', () => {
  it('pluralizes words, characters and pages', () => {
    expect(documentCountsLabel(1, 1, 1)).toBe('1 word · 1 character · 1 page');
    expect(documentCountsLabel(2, 9, 3)).toBe('2 words · 9 characters · 3 pages');
  });

  it('reports at least one page for an empty document', () => {
    expect(documentCountsLabel(0, 0, 0)).toBe('0 words · 0 characters · 1 page');
  });

  it('groups thousands so a long document stays readable', () => {
    expect(documentCountsLabel(12000, 65000, 24)).toContain('24 pages');
  });
});

describe('delete confirmation', () => {
  it('warns that the keys are held only by this account', () => {
    expect(documentDeleteConfirmation(1)).toContain('permanent');
    expect(documentDeleteConfirmation(1)).toContain('nobody');
  });

  it('does not promise anything about inheritance, which left the product', () => {
    expect(documentDeleteConfirmation(3)).not.toContain('inherit');
  });
});

describe('document thumbnails', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('keeps the line structure so the miniature reads like a page', () => {
    expect(documentThumbnail('Title\nFirst line\nSecond line')).toBe(
      'Title\nFirst line\nSecond line',
    );
  });

  it('collapses runs of blank lines rather than wasting the miniature on them', () => {
    expect(documentThumbnail('One\n\n\n\n\nTwo')).toBe('One\n\nTwo');
  });

  it('trims the surrounding whitespace', () => {
    expect(documentThumbnail('\n\n  Body  \n\n')).toBe('Body');
  });

  it('truncates past the thumbnail budget', () => {
    const thumbnail = documentThumbnail('y'.repeat(DOCUMENT_THUMBNAIL_MAX_CHARACTERS + 50));

    expect(Array.from(thumbnail)).toHaveLength(DOCUMENT_THUMBNAIL_MAX_CHARACTERS + 1);
    expect(thumbnail.endsWith('…')).toBe(true);
  });

  it('is empty for a document that could not be decrypted', () => {
    const [tile] = buildDocumentTiles([summary({ readable: false, preview: 'x' })], now);

    expect(tile.thumbnail).toBe('');
  });

  it('carries far more of the body than the one-line preview does', () => {
    const body = Array.from({ length: 40 }, (_, line) => `Line ${line} of the document`).join('\n');
    const [tile] = buildDocumentTiles([summary({ preview: body })], now);

    expect(tile.thumbnail.length).toBeGreaterThan(tile.preview.length);
    expect(tile.thumbnail).toContain('\n');
  });
});
