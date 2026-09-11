import { describe, expect, it } from 'vitest';
import {
  DELETED_SPACE_RETURNS,
  NEARLY_FULL_AT,
  PRIMARY_MISSING,
  REPLICATION_DONE,
  REPLICATION_FAILED,
  REPLICATION_PENDING,
  UNREADABLE_FILE_NAME,
  UPLOAD_UNFINISHED,
  fileBatchDeleteConfirmation,
  fileBatchDeleteSummary,
  fileCountLabel,
  discardConfirmation,
  fileDeleteConfirmation,
  fileCaption,
  fileExtension,
  fileKind,
  fileName,
  formatBytes,
  isOpenable,
  isResumable,
  replicationLabel,
  resumeHint,
  storageBar,
  storageFullMessage,
  toggleFileSelection,
  transferLabel,
  uploadPercent,
} from './index';

describe('byte formatting', () => {
  it('reaches the units a drive needs, not just megabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
    expect(formatBytes(15 * 1024 ** 3)).toBe('15.0 GiB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TiB');
  });

  it('renders the free tier as the round number it is', () => {
    expect(formatBytes(524_288_000)).toBe('500.0 MiB');
  });

  it('does not print nonsense for a missing number', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('file names', () => {
  it('truncates a very long name', () => {
    expect(fileName('a'.repeat(200))).toHaveLength(81);
    expect(fileName('a'.repeat(200)).endsWith('…')).toBe(true);
  });

  it('falls back when a manifest could not be read', () => {
    expect(fileName('   ')).toBe(UNREADABLE_FILE_NAME);
  });
});

describe('file kinds', () => {
  it('recognises the kinds a grid needs an icon for', () => {
    expect(fileKind('image/png')).toBe('image');
    expect(fileKind('video/mp4')).toBe('video');
    expect(fileKind('audio/mpeg')).toBe('audio');
    expect(fileKind('application/pdf')).toBe('pdf');
    expect(fileKind('text/plain')).toBe('text');
    expect(fileKind('application/zip')).toBe('archive');
    expect(fileKind('application/octet-stream')).toBe('other');
  });

  it('is case-insensitive, because a MIME type from a file picker may not be', () => {
    expect(fileKind('IMAGE/PNG')).toBe('image');
  });

  it('separates the office families, because they get different icons', () => {
    expect(fileKind('application/msword')).toBe('document');
    expect(
      fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('document');
    expect(fileKind('application/vnd.oasis.opendocument.text')).toBe('document');
    expect(fileKind('application/vnd.ms-excel')).toBe('sheet');
    expect(
      fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('sheet');
    expect(fileKind('application/vnd.ms-powerpoint')).toBe('slides');
    expect(fileKind('application/json')).toBe('code');
  });

  it('reads a spreadsheet as a sheet even though its MIME type starts with text/', () => {
    expect(fileKind('text/csv')).toBe('sheet');
    expect(fileKind('text/plain')).toBe('text');
  });
});

describe('the extension a glyph is labelled with', () => {
  it('is the suffix, upper-cased, because that is what a file manager shows', () => {
    expect(fileExtension('quarterly.pdf')).toBe('PDF');
    expect(fileExtension('notes.DocX')).toBe('DOCX');
    expect(fileExtension('archive.tar.gz')).toBe('GZ');
  });

  it('is empty when there is nothing short and plain to show', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileExtension('report.')).toBe('');
    expect(fileExtension('backup.tarball')).toBe('');
    expect(fileExtension('version.1-final')).toBe('');
  });
});

describe('the line under a file name', () => {
  it('shows the size once there is nothing left to say about durability', () => {
    expect(fileCaption(REPLICATION_DONE, 2048)).toBe('2.0 KiB');
    expect(fileCaption('', 2048)).toBe('2.0 KiB');
  });

  it('gives the durability claim the line back whenever it still has one to make', () => {
    expect(fileCaption(REPLICATION_PENDING, 2048)).toBe(REPLICATION_PENDING);
    expect(fileCaption(REPLICATION_FAILED, 2048)).toBe(REPLICATION_FAILED);
    expect(fileCaption(UPLOAD_UNFINISHED, 2048)).toBe(UPLOAD_UNFINISHED);
    expect(fileCaption(PRIMARY_MISSING, 2048)).toBe(PRIMARY_MISSING);
  });
});

describe('what the UI is allowed to claim about durability', () => {
  it('promises one copy and a minute, never two providers', () => {
    const label = replicationLabel({ r2_state: 'ok', gcs_state: 'pending' });

    expect(label).toBe(REPLICATION_PENDING);
    expect(label).toContain('within a minute');
    expect(label.toLowerCase()).not.toContain('two');
    expect(label.toLowerCase()).not.toContain('provider');
  });

  it('says a second copy exists only once it does', () => {
    expect(replicationLabel({ r2_state: 'ok', gcs_state: 'ok' })).toBe(REPLICATION_DONE);
  });

  it('does not hide a failed replica behind the happy message', () => {
    expect(replicationLabel({ r2_state: 'ok', gcs_state: 'failed' })).toBe(REPLICATION_FAILED);
  });

  it('says a pending upload is not in the vault', () => {
    expect(replicationLabel({ r2_state: 'pending', gcs_state: 'pending' })).toBe(UPLOAD_UNFINISHED);
    expect(isOpenable({ r2_state: 'pending' })).toBe(false);
  });

  it('marks a lost primary as unopenable rather than merely unreplicated', () => {
    expect(replicationLabel({ r2_state: 'missing', gcs_state: 'ok' })).toBe(PRIMARY_MISSING);
    expect(isOpenable({ r2_state: 'missing' })).toBe(false);
  });

  it('opens a file the moment R2 has it, without waiting for the replica', () => {
    expect(isOpenable({ r2_state: 'ok' })).toBe(true);
  });
});

describe('the storage bar', () => {
  it('draws what R2 holds, not what has been reserved', () => {
    const bar = storageBar({
      used_bytes: 262_144_000,
      stored_bytes: 262_144_000,
      quota_bytes: 524_288_000,
      file_count: 3,
    });

    expect(bar.percent).toBe(50);
    expect(bar.summary).toBe('250.0 MiB of 500.0 MiB used');
    expect(bar.uploadingSummary).toBeUndefined();
    expect(bar.reservedPercent).toBe(0);
    expect(bar.nearlyFull).toBe(false);
  });

  it('keeps an unfinished upload out of the fill and says so separately', () => {
    const bar = storageBar({
      used_bytes: 314_572_800,
      stored_bytes: 262_144_000,
      quota_bytes: 524_288_000,
      file_count: 4,
    });

    expect(bar.percent).toBe(50);
    expect(bar.summary).toBe('250.0 MiB of 500.0 MiB used');
    expect(bar.reservedPercent).toBe(10);
    expect(bar.uploadingSummary).toBe('50.0 MiB held by unfinished uploads');
  });

  it('warns on what the ceiling counts, not on what is stored', () => {
    const at = storageBar({
      used_bytes: Math.ceil(524_288_000 * NEARLY_FULL_AT),
      stored_bytes: 0,
      quota_bytes: 524_288_000,
      file_count: 1,
    });

    expect(at.nearlyFull).toBe(true);
    expect(at.percent).toBe(0);
  });

  it('never runs past full, even if the ledger briefly disagrees', () => {
    const bar = storageBar({
      used_bytes: 600_000_000,
      stored_bytes: 600_000_000,
      quota_bytes: 524_288_000,
      file_count: 1,
    });

    expect(bar.percent).toBe(100);
    expect(bar.percent + bar.reservedPercent).toBe(100);
  });

  it('does not divide by a zero quota', () => {
    const bar = storageBar({ used_bytes: 10, stored_bytes: 5, quota_bytes: 0, file_count: 1 });

    expect(bar.percent).toBe(0);
    expect(bar.reservedPercent).toBe(0);
    expect(bar.nearlyFull).toBe(false);
  });
});

describe('copy that has to say the quota is not freed instantly', () => {
  it('tells a deleter when the space comes back', () => {
    const message = fileDeleteConfirmation('passport.pdf');

    expect(message).toContain('passport.pdf');
    expect(message).toContain('permanent');
    expect(message).toContain(DELETED_SPACE_RETURNS);
  });

  it('tells someone who hit the ceiling what they need and what is free', () => {
    const message = storageFullMessage(
      { used_bytes: 500_000_000, stored_bytes: 500_000_000, quota_bytes: 524_288_000, file_count: 9 },
      100_000_000,
    );

    expect(message).toContain('95.4 MiB');
    expect(message).toContain('23.2 MiB');
    expect(message).toContain(DELETED_SPACE_RETURNS);
  });

  it('does not offer negative free space when the ledger is over', () => {
    const message = storageFullMessage(
      { used_bytes: 600_000_000, stored_bytes: 600_000_000, quota_bytes: 524_288_000, file_count: 9 },
      1000,
    );

    expect(message).toContain('0 B is free');
  });
});

describe('small labels', () => {
  it('pluralizes the count', () => {
    expect(fileCountLabel(1)).toBe('1 file');
    expect(fileCountLabel(0)).toBe('0 files');
  });

  it('reports upload progress as a bounded percentage', () => {
    expect(uploadPercent(0, 100)).toBe(0);
    expect(uploadPercent(50, 100)).toBe(50);
    expect(uploadPercent(150, 100)).toBe(100);
    expect(uploadPercent(1, 0)).toBe(0);
  });
});

describe('deleting a selection', () => {
  it('names the count and repeats the promise nobody can restore them', () => {
    const message = fileBatchDeleteConfirmation(3);

    expect(message).toContain('these 3 files');
    expect(message).toContain('restore them');
    expect(message).toContain(DELETED_SPACE_RETURNS);
  });

  it('reads naturally for a single file', () => {
    const message = fileBatchDeleteConfirmation(1);

    expect(message).toContain('this file');
    expect(message).toContain('restore it');
    expect(message).not.toContain('these 1');
  });

  it('says nothing when every file asked for was deleted', () => {
    expect(fileBatchDeleteSummary({ requested: 4, deleted: 4 })).toBeUndefined();
  });

  it('explains a shortfall as a stale list rather than a failure', () => {
    const message = fileBatchDeleteSummary({ requested: 4, deleted: 3 });

    expect(message).toBe('Deleted 3 of 4 — 1 file was already gone.');
    expect(message).not.toContain('fail');
  });

  it('handles the whole set having been gone already', () => {
    expect(fileBatchDeleteSummary({ requested: 2, deleted: 0 })).toBe(
      '2 files were already gone. The list is now up to date.',
    );
  });
});

describe('selection', () => {
  it('adds an unselected id and removes a selected one', () => {
    expect(toggleFileSelection([], 'a')).toEqual(['a']);
    expect(toggleFileSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('never mutates the list it was given', () => {
    const selected = ['a'];
    toggleFileSelection(selected, 'b');

    expect(selected).toEqual(['a']);
  });
});

describe('an unfinished upload', () => {
  it('is resumable while it is pending, and never once it is stored', () => {
    expect(isResumable({ r2_state: 'pending' })).toBe(true);
    expect(isResumable({ r2_state: 'ok' })).toBe(false);
    expect(isResumable({ r2_state: 'missing' })).toBe(false);
  });

  it('is never openable and resumable at once', () => {
    for (const state of ['pending', 'ok', 'missing'] as const) {
      expect(isOpenable({ r2_state: state }) && isResumable({ r2_state: state })).toBe(false);
    }
  });
});

describe('the resume hint', () => {
  it('says the device still has the file when the handle survived', () => {
    expect(resumeHint('holiday.mov', true)).toBe(
      'Finish uploading holiday.mov — this device still has the file',
    );
  });

  it('asks for the file back when it did not', () => {
    expect(resumeHint('holiday.mov', false)).toBe(
      'Finish uploading holiday.mov — pick the same file again',
    );
  });

  it('trims an unreasonable name the same way every other label does', () => {
    expect(resumeHint('a'.repeat(200), true)).toContain(UNREADABLE_FILE_NAME.slice(0, 0) + 'a'.repeat(80));
  });
});

describe('what a running transfer says', () => {
  it('counts up while bytes are moving', () => {
    expect(transferLabel('uploading', 0)).toBe('Uploading… 0%');
    expect(transferLabel('uploading', 42)).toBe('Uploading… 42%');
  });

  it('stops counting once the bytes are all sent', () => {
    expect(transferLabel('completing', 100)).toBe('Finishing the upload…');
  });

  it('never reads as an unfinished upload, which is the label it replaces', () => {
    expect(transferLabel('uploading', 5)).not.toBe(UPLOAD_UNFINISHED);
    expect(transferLabel('completing', 100)).not.toBe(UPLOAD_UNFINISHED);
  });
});

describe('discarding an unfinished upload', () => {
  it('says what is lost and what comes back, and never calls it a stored file', () => {
    const message = discardConfirmation('holiday.mov');

    expect(message).toContain('holiday.mov');
    expect(message).toContain('never finished');
    expect(message).toContain('comes back at once');
  });

  it('does not borrow the permanence warning a real delete carries', () => {
    expect(discardConfirmation('a.pdf')).not.toContain('permanent');
    expect(discardConfirmation('a.pdf')).not.toContain(DELETED_SPACE_RETURNS);
  });
});
