import { describe, expect, it } from 'vitest';
import {
  RECENTLY_DELETED_SUBTITLE,
  SECRET_DELETE_CONFIRMATION,
  SECRET_PURGE_CONFIRMATION,
  UNREADABLE_SECRET_NAME,
  buildDeletedVaultRows,
  encodeSecretPayload,
  purgeConfirmationTitle,
} from './index';

function deletedRecord(id: string, deletedAt: string) {
  return {
    id,
    ciphertext: 'c',
    wrapped_dek: 'w',
    key_generation: 1,
    version: 'v1',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    deleted_at: deletedAt,
  };
}

describe('deleting a secret', () => {
  it('says where it goes and that it can come back, because a delete no longer destroys', () => {
    expect(SECRET_DELETE_CONFIRMATION).toMatch(/Recently deleted/);
    expect(SECRET_DELETE_CONFIRMATION).toMatch(/restored/);
    expect(SECRET_DELETE_CONFIRMATION).not.toMatch(/permanent:/);
  });

  it('says a deleted secret is still stored, as ADR 00016 requires', () => {
    expect(SECRET_DELETE_CONFIRMATION).toMatch(/stays stored/);
    expect(RECENTLY_DELETED_SUBTITLE).toMatch(/permanently/);
  });

  it('keeps the irreversible sentence for the purge alone', () => {
    expect(SECRET_PURGE_CONFIRMATION).toMatch(/cannot be undone/);
    expect(purgeConfirmationTitle(1)).toBe('Delete this secret permanently?');
    expect(purgeConfirmationTitle(3)).toBe('Delete 3 secrets permanently?');
  });
});

describe('the Recently deleted list', () => {
  it('names each secret and puts the most recently deleted first', () => {
    const rows = buildDeletedVaultRows([
      { record: deletedRecord('a', '2026-09-01T00:00:00Z'), plaintext: encodeSecretPayload({ name: 'Old', value: 'x' }) },
      { record: deletedRecord('b', '2026-09-28T00:00:00Z'), plaintext: encodeSecretPayload({ name: 'New', value: 'y' }) },
    ]);

    expect(rows.map((row) => row.name)).toEqual(['New', 'Old']);
    expect(rows[0]).toEqual({ id: 'b', name: 'New', readable: true, deletedAt: '2026-09-28T00:00:00Z' });
  });

  it('keeps a row it cannot open, so it can still be restored or purged', () => {
    const [row] = buildDeletedVaultRows([{ record: deletedRecord('a', '2026-09-01T00:00:00Z') }]);

    expect(row).toMatchObject({ id: 'a', name: UNREADABLE_SECRET_NAME, readable: false });
  });

  it('never carries the value, which the panel has no reason to hold', () => {
    const [row] = buildDeletedVaultRows([
      { record: deletedRecord('a', '2026-09-01T00:00:00Z'), plaintext: encodeSecretPayload({ name: 'Bank', value: 'secret' }) },
    ]);

    expect(Object.values(row)).not.toContain('secret');
  });
});
