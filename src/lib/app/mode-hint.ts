import type { VaultStorage } from '@/lib/pin';

export const MODE_HINT_STORAGE_KEY = 'cryple_mode_hint';

export type ModeHint = 'standard' | 'paranoid';

function defaultStorage(): VaultStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export function readModeHint(storage = defaultStorage()): ModeHint | undefined {
  const raw = storage?.getItem(MODE_HINT_STORAGE_KEY);
  return raw === 'standard' || raw === 'paranoid' ? raw : undefined;
}

export function writeModeHint(paranoid: boolean, storage = defaultStorage()): void {
  storage?.setItem(MODE_HINT_STORAGE_KEY, paranoid ? 'paranoid' : 'standard');
}

export function clearModeHint(storage = defaultStorage()): void {
  storage?.removeItem(MODE_HINT_STORAGE_KEY);
}

export function signInAttemptOrder(hint: ModeHint | undefined): boolean[] {
  if (hint === 'paranoid') {
    return [true, false];
  }
  if (hint === 'standard') {
    return [false, true];
  }
  return [true, false];
}
