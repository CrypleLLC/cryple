import { describe, expect, it } from 'vitest';
import {
  LEGACY_STORAGE_KEYS,
  assertValidPin,
  discardLegacyState,
  validatePin,
  type LegacyStorage,
} from './index';

function memoryStorage(entries: Record<string, string>): LegacyStorage & { entries: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    entries: map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    removeItem: (key) => void map.delete(key),
  };
}

describe('PIN format rules', () => {
  it('accepts a well-formed PIN', () => {
    expect(validatePin('428193')).toEqual({ valid: true });
    expect(() => assertValidPin('428193')).not.toThrow();
  });

  it('rejects the wrong length', () => {
    expect(validatePin('12345')).toEqual({ valid: false, reason: 'wrong-length' });
    expect(validatePin('1234567')).toEqual({ valid: false, reason: 'wrong-length' });
    expect(validatePin('')).toEqual({ valid: false, reason: 'wrong-length' });
  });

  it('rejects non-ASCII-digit characters', () => {
    expect(validatePin('12345a')).toEqual({ valid: false, reason: 'non-digit' });
    expect(validatePin('12 456')).toEqual({ valid: false, reason: 'non-digit' });
    expect(validatePin('١٢٣٤٥٦')).toEqual({ valid: false, reason: 'non-digit' });
  });

  it('rejects all-repeating digits', () => {
    for (const digit of '0123456789') {
      expect(validatePin(digit.repeat(6))).toEqual({
        valid: false,
        reason: 'repeating-digit',
      });
    }
  });

  it('rejects ascending and descending runs', () => {
    expect(validatePin('123456')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('012345')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('456789')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('654321')).toEqual({ valid: false, reason: 'descending-sequence' });
    expect(validatePin('987654')).toEqual({ valid: false, reason: 'descending-sequence' });
  });

  it('allows near-sequences that are not strict runs', () => {
    expect(validatePin('123457').valid).toBe(true);
    expect(validatePin('112233').valid).toBe(true);
  });
});

describe('what the seed-vault client left behind', () => {
  it('deletes the encrypted seed, the mode hint, the sealed pins and every plaintext pin', () => {
    const storage = memoryStorage({
      encrypted_seed: '{"v":1}',
      cryple_mode_hint: 'paranoid',
      'cryple.sharing.pins': 'sealed',
      'cryple.sharing.fingerprint.a': 'AAAA',
      'cryple.sharing.fingerprint.b': 'BBBB',
      cryple_drive_icon_size: 'large',
    });

    const removed = discardLegacyState(storage);

    expect([...storage.entries.keys()]).toEqual(['cryple_drive_icon_size']);
    expect(removed.sort()).toEqual(
      [
        'encrypted_seed',
        'cryple_mode_hint',
        'cryple.sharing.pins',
        'cryple.sharing.fingerprint.a',
        'cryple.sharing.fingerprint.b',
      ].sort(),
    );
  });

  it('never keeps a v: 1 seed record, whatever it contains', () => {
    expect(LEGACY_STORAGE_KEYS).toContain('encrypted_seed');
  });

  it('reports nothing when there is nothing to delete', () => {
    expect(discardLegacyState(memoryStorage({ cryple_notes_icon_size: 'small' }))).toEqual([]);
    expect(discardLegacyState(undefined)).toEqual([]);
  });
});
