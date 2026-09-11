import type { StorageUsage } from '@/lib/files';

let current: StorageUsage | undefined;
const listeners = new Set<() => void>();

export function storageUsage(): StorageUsage | undefined {
  return current;
}

export function subscribeToStorageUsage(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function setStorageUsage(usage: StorageUsage): void {
  if (
    current !== undefined &&
    current.used_bytes === usage.used_bytes &&
    current.stored_bytes === usage.stored_bytes &&
    current.quota_bytes === usage.quota_bytes &&
    current.file_count === usage.file_count
  ) {
    return;
  }

  current = usage;
  for (const listener of listeners) {
    listener();
  }
}

export function forgetStorageUsage(): void {
  current = undefined;
  for (const listener of listeners) {
    listener();
  }
}
