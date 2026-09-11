import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetStorageUsage,
  setStorageUsage,
  storageUsage,
  subscribeToStorageUsage,
} from './usage';

const usage = { used_bytes: 100, stored_bytes: 60, quota_bytes: 1000, file_count: 2 };

afterEach(() => forgetStorageUsage());

describe('the usage every screen shares', () => {
  it('is nothing until something reports it', () => {
    expect(storageUsage()).toBeUndefined();
  });

  it('keeps the same object until a number actually changes', () => {
    setStorageUsage(usage);
    const first = storageUsage();

    setStorageUsage({ ...usage });
    expect(storageUsage()).toBe(first);

    setStorageUsage({ ...usage, stored_bytes: 100 });
    expect(storageUsage()).not.toBe(first);
  });

  it('does not wake a subscriber for a reading that says the same thing', () => {
    const listener = vi.fn();
    subscribeToStorageUsage(listener);

    setStorageUsage(usage);
    setStorageUsage({ ...usage });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers when it changes, and stops when they leave', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStorageUsage(listener);

    setStorageUsage(usage);
    unsubscribe();
    setStorageUsage({ ...usage, used_bytes: 200 });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
