import { describe, expect, it } from 'vitest';
import {
  ABANDONED_LOCAL_STORAGE_KEYS,
  ABANDONED_LOCAL_STORAGE_PREFIXES,
  discardAbandonedLocalStorage,
} from './store';

function fakeStorage(initial: Record<string, string>, throwsOn?: string): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length() {
      return entries.size;
    },
    key(index: number) {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
    removeItem(key: string) {
      if (key === throwsOn) {
        throw new Error('storage is blocked in this context');
      }
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  } as Storage;
}

describe('discardAbandonedLocalStorage', () => {
  it('removes every key an earlier build used to hold the wrapped seed', () => {
    const storage = fakeStorage({ encrypted_seed: '{"ct":"…"}', cryple_mode_hint: 'standard' });
    discardAbandonedLocalStorage(storage);
    for (const key of ABANDONED_LOCAL_STORAGE_KEYS) {
      expect(storage.getItem(key)).toBeNull();
    }
  });

  it('sweeps the plaintext sharing pins by prefix, however many there are', () => {
    const storage = fakeStorage({
      'cryple.sharing.fingerprint.aaa': '1111-2222',
      'cryple.sharing.fingerprint.bbb': '3333-4444',
      'cryple.sharing.fingerprint.ccc': '5555-6666',
    });
    discardAbandonedLocalStorage(storage);
    expect(storage.length).toBe(0);
  });

  it('keeps every key this build owns', () => {
    const storage = fakeStorage({
      encrypted_seed: 'gone',
      cryple_icon_size: 'large',
      'cryple.sharing.nickname.aaa': 'kept',
    });
    discardAbandonedLocalStorage(storage);
    expect(storage.getItem('cryple_icon_size')).toBe('large');
    expect(storage.getItem('cryple.sharing.nickname.aaa')).toBe('kept');
    expect(storage.getItem('encrypted_seed')).toBeNull();
  });

  it('names both the keys and the prefixes, so neither is forgotten', () => {
    expect(ABANDONED_LOCAL_STORAGE_KEYS).toContain('encrypted_seed');
    expect(ABANDONED_LOCAL_STORAGE_KEYS).toContain('cryple_mode_hint');
    expect(ABANDONED_LOCAL_STORAGE_PREFIXES).toContain('cryple.sharing.fingerprint.');
  });

  it('gives up quietly where storage is blocked rather than failing the boot', () => {
    const storage = fakeStorage({ encrypted_seed: 'stays' }, 'encrypted_seed');
    expect(() => discardAbandonedLocalStorage(storage)).not.toThrow();
    expect(storage.getItem('encrypted_seed')).toBe('stays');
  });

  it('does nothing where there is no storage at all', () => {
    expect(() => discardAbandonedLocalStorage(undefined)).not.toThrow();
  });
});
