import { describe, expect, it } from 'vitest';
import { storedFileCount } from './count';

describe('counting the files a user has', () => {
  it('leaves out thumbnails, which are file rows of their own', () => {
    const records = [
      { id: 'photo', r2_state: 'ok' as const },
      { id: 'photo-thumbnail', r2_state: 'ok' as const },
      { id: 'report', r2_state: 'ok' as const },
    ];

    expect(storedFileCount(records, new Set(['photo-thumbnail']))).toBe(2);
  });

  it('leaves out uploads that never finished, and files being repaired', () => {
    const records = [
      { id: 'stored', r2_state: 'ok' as const },
      { id: 'unfinished', r2_state: 'pending' as const },
      { id: 'lost', r2_state: 'missing' as const },
    ];

    expect(storedFileCount(records, new Set())).toBe(1);
  });

  it('is zero for an empty drive', () => {
    expect(storedFileCount([], new Set())).toBe(0);
  });
});
