export const LEGACY_STORAGE_KEYS = [
  'encrypted_seed',
  'cryple_mode_hint',
  'cryple.sharing.pins',
] as const;

export const LEGACY_STORAGE_PREFIXES = ['cryple.sharing.fingerprint.'] as const;

export interface LegacyStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

function browserStorage(): LegacyStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function discardLegacyState(storage: LegacyStorage | undefined = browserStorage()): string[] {
  if (storage === undefined) {
    return [];
  }
  const doomed = new Set<string>(LEGACY_STORAGE_KEYS);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && LEGACY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      doomed.add(key);
    }
  }
  const removed: string[] = [];
  for (const key of doomed) {
    if (storage.getItem(key) !== null) {
      storage.removeItem(key);
      removed.push(key);
    }
  }
  return removed;
}
