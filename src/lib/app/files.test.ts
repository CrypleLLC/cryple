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
  fileCountLabel,
  fileDeleteConfirmation,
  fileKind,
  fileName,
  formatBytes,
  isOpenable,
  replicationLabel,
  storageBar,
  storageFullMessage,
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
  it('matches what the usage endpoint reports', () => {
    const bar = storageBar({ used_bytes: 262_144_000, quota_bytes: 524_288_000, file_count: 3 });

    expect(bar.percent).toBe(50);
    expect(bar.summary).toBe('250.0 MiB of 500.0 MiB used');
    expect(bar.nearlyFull).toBe(false);
  });

  it('warns before the ceiling rather than at it', () => {
    const at = storageBar({
      used_bytes: Math.ceil(524_288_000 * NEARLY_FULL_AT),
      quota_bytes: 524_288_000,
      file_count: 1,
    });

    expect(at.nearlyFull).toBe(true);
  });

  it('never runs past full, even if the ledger briefly disagrees', () => {
    const bar = storageBar({ used_bytes: 600_000_000, quota_bytes: 524_288_000, file_count: 1 });

    expect(bar.percent).toBe(100);
  });

  it('does not divide by a zero quota', () => {
    const bar = storageBar({ used_bytes: 10, quota_bytes: 0, file_count: 1 });

    expect(bar.percent).toBe(0);
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
      { used_bytes: 500_000_000, quota_bytes: 524_288_000, file_count: 9 },
      100_000_000,
    );

    expect(message).toContain('95.4 MiB');
    expect(message).toContain('23.2 MiB');
    expect(message).toContain(DELETED_SPACE_RETURNS);
  });

  it('does not offer negative free space when the ledger is over', () => {
    const message = storageFullMessage(
      { used_bytes: 600_000_000, quota_bytes: 524_288_000, file_count: 9 },
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
