import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_STATUS,
  FILE_STATUS_SHORT,
  LISTING_EMPTY_CELL,
  actionsHeader,
  dateAndTimeLabels,
  documentStatusLabel,
  fileStatusShortLabel,
  listingDateLabel,
  newestCreatedFirst,
} from './index';

describe('the order a list draws its rows in', () => {
  it('puts the most recently created first', () => {
    const rows = [
      { id: 'old', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'new', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'mid', createdAt: '2026-05-01T00:00:00Z' },
    ];

    expect(newestCreatedFirst(rows).map((row) => row.id)).toEqual(['new', 'mid', 'old']);
  });

  it('puts a row with no creation time yet, an upload in flight, above everything', () => {
    const rows = [
      { id: 'stored', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'uploading', createdAt: '' },
    ];

    expect(newestCreatedFirst(rows).map((row) => row.id)).toEqual(['uploading', 'stored']);
  });

  it('leaves the input untouched', () => {
    const rows = [
      { createdAt: '2026-01-01T00:00:00Z' },
      { createdAt: '2026-09-01T00:00:00Z' },
    ];
    newestCreatedFirst(rows);

    expect(rows[0].createdAt).toBe('2026-01-01T00:00:00Z');
  });
});

describe('the modified column', () => {
  const now = new Date(2026, 8, 28, 15, 0);

  it('shows the time for today, and no year for this year', () => {
    expect(listingDateLabel(new Date(2026, 8, 28, 9, 30).toISOString(), now)).not.toContain('2026');
    expect(listingDateLabel(new Date(2026, 2, 3).toISOString(), now)).not.toContain('2026');
  });

  it('names the year for an earlier one', () => {
    expect(listingDateLabel(new Date(2024, 2, 3).toISOString(), now)).toContain('2024');
  });

  it('draws a dash rather than a wrong date', () => {
    expect(listingDateLabel('', now)).toBe(LISTING_EMPTY_CELL);
    expect(listingDateLabel('yesterday', now)).toBe(LISTING_EMPTY_CELL);
  });
});

describe('a date over a time', () => {
  it('splits one moment into the day and the minute', () => {
    const at = new Date(2026, 8, 28, 9, 5).toISOString();
    const { date, time } = dateAndTimeLabels(at);

    expect(date).toBe(new Date(at).toLocaleDateString());
    expect(time).toMatch(/\d/);
    expect(time).not.toContain('2026');
    expect(date).not.toBe(time);
  });

  it('draws a dash and no time rather than a wrong date', () => {
    expect(dateAndTimeLabels('')).toEqual({ date: LISTING_EMPTY_CELL, time: '' });
    expect(dateAndTimeLabels('soon')).toEqual({ date: LISTING_EMPTY_CELL, time: '' });
  });
});

describe('the heading over a row\'s buttons', () => {
  it('names the buttons in the order they are drawn', () => {
    expect(actionsHeader('Copy', 'Share', 'Delete')).toBe('Copy | Share | Delete');
  });

  it('leaves out a button the row will not draw', () => {
    expect(actionsHeader('Copy', false, 'Share', false)).toBe('Copy | Share');
  });
});

describe('the status column', () => {
  it('names each storage state in a few words', () => {
    expect(fileStatusShortLabel({ r2_state: 'missing', gcs_state: 'ok' })).toBe(FILE_STATUS_SHORT.repairing);
    expect(fileStatusShortLabel({ r2_state: 'pending', gcs_state: 'pending' })).toBe(
      FILE_STATUS_SHORT.unfinished,
    );
    expect(fileStatusShortLabel({ r2_state: 'ok', gcs_state: 'ok' })).toBe(FILE_STATUS_SHORT.replicated);
    expect(fileStatusShortLabel({ r2_state: 'ok', gcs_state: 'failed' })).toBe(
      FILE_STATUS_SHORT.replicaFailed,
    );
    expect(fileStatusShortLabel({ r2_state: 'ok', gcs_state: 'pending' })).toBe(
      FILE_STATUS_SHORT.replicating,
    );
  });

  it('never claims a second copy before one exists', () => {
    const pending = fileStatusShortLabel({ r2_state: 'ok', gcs_state: 'pending' }).toLowerCase();

    expect(pending).not.toContain('two');
    expect(pending).not.toContain('provider');
    expect(pending).not.toBe(FILE_STATUS_SHORT.replicated.toLowerCase());
  });

  it('says when a document could not be opened', () => {
    expect(documentStatusLabel(true)).toBe(DOCUMENT_STATUS.saved);
    expect(documentStatusLabel(false)).toBe(DOCUMENT_STATUS.unreadable);
  });
});
