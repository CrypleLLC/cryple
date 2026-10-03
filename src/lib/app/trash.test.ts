import { describe, expect, it } from 'vitest';
import {
  daysLeft,
  deleteActionLabel,
  trashEntryDetail,
  trashEntryName,
  trashExpiryLabel,
  trashRetentionNotice,
} from './trash';
import { documentDeleteConfirmation } from './documents';
import { fileBatchDeleteConfirmation, fileDeleteConfirmation } from './files';
import { folderDeleteConfirmation, DOCUMENT_NOUNS } from './folders';

describe('the Trash copy', () => {
  it('says plainly when the account keeps nothing', () => {
    expect(trashRetentionNotice(0)).toMatch(/does not keep deleted/);
    expect(trashRetentionNotice(30)).toMatch(/30 days/);
  });

  it('counts the days left from the deletion, and never below zero', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    expect(daysLeft('2026-10-01T12:00:00Z', 30, now)).toBe(28);
    expect(daysLeft('2026-08-01T12:00:00Z', 30, now)).toBe(0);
    expect(trashExpiryLabel('2026-10-02T12:00:00Z', 30, now)).toBe('Deleted for good in 29 days');
    expect(trashExpiryLabel('2026-08-01T12:00:00Z', 30, now)).toBe('Deleted for good today');
  });

  it('names what cannot be read by its kind', () => {
    expect(trashEntryName({ kind: 'document', name: '  ' })).toBe('Untitled document');
    expect(trashEntryName({ kind: 'folder', name: undefined })).toBe('Unreadable folder');
    expect(trashEntryName({ kind: 'file', name: 'tax.pdf' })).toBe('tax.pdf');
  });

  it('says where an entry came from, and how much a folder holds', () => {
    expect(trashEntryDetail({ kind: 'folder', scope: 'files', itemCount: 1 })).toBe('Folder · Drive · 1 file');
    expect(trashEntryDetail({ kind: 'folder', scope: 'documents', itemCount: 4 })).toBe(
      'Folder · Documents · 4 documents',
    );
    expect(trashEntryDetail({ kind: 'document', scope: 'documents' })).toBe('Document · Documents');
  });
});

describe('deleting, with and without a Trash', () => {
  it('keeps saying permanent when the account keeps nothing', () => {
    expect(documentDeleteConfirmation(1)).toMatch(/permanent/);
    expect(fileDeleteConfirmation('a.txt', 0)).toMatch(/permanent/);
    expect(folderDeleteConfirmation('Taxes', 0, DOCUMENT_NOUNS, 0)).toMatch(/permanently/);
    expect(deleteActionLabel(0)).toBe('Delete permanently');
  });

  it('says the Trash and how long, when the account keeps deleted items', () => {
    expect(documentDeleteConfirmation(2, 30)).toBe(
      'These 2 documents go to the Trash, where you can restore them for 30 days. After that they are deleted for good.',
    );
    expect(fileDeleteConfirmation('a.txt', 30)).toMatch(/goes to the Trash.*30 days.*space is freed now/);
    expect(fileBatchDeleteConfirmation(1, 30)).toMatch(/^This file goes to the Trash/);
    expect(folderDeleteConfirmation('Taxes', 0, DOCUMENT_NOUNS, 30)).toMatch(/goes to the Trash.*restore it, whole/);
    expect(deleteActionLabel(30)).toBe('Move to Trash');
  });
});
