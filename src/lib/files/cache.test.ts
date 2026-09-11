import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cachedObjectIds,
  dropCachedObject,
  pruneCachedObjects,
  readCachedObject,
  writeCachedObject,
} from './cache';

function originPrivateFileSystem(options: { failWrites?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();

  const directory = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name) && opts?.create !== true) {
        throw new Error('NotFoundError');
      }

      return {
        async getFile() {
          const held = files.get(name);
          if (held === undefined) {
            throw new Error('NotFoundError');
          }

          return {
            arrayBuffer: async () =>
              held.buffer.slice(held.byteOffset, held.byteOffset + held.byteLength) as ArrayBuffer,
          };
        },
        async createWritable() {
          const parts: Uint8Array[] = [];

          return {
            async write(chunk: Uint8Array) {
              if (options.failWrites === true) {
                throw new Error('QuotaExceededError');
              }
              parts.push(chunk);
            },
            async close() {
              files.set(name, parts[0] ?? new Uint8Array());
            },
          };
        },
      };
    },
    async getDirectoryHandle() {
      return directory;
    },
    async removeEntry(name: string) {
      files.delete(name);
    },
    async *keys() {
      for (const name of [...files.keys()]) {
        yield name;
      }
    },
  };

  vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory } });

  return files;
}

afterEach(() => vi.unstubAllGlobals());

describe('the object cache', () => {
  it('hands back exactly the bytes it was given', async () => {
    originPrivateFileSystem();
    const sealed = new Uint8Array([1, 2, 3, 250]);

    expect(await writeCachedObject('a', sealed)).toBe(true);
    expect(await readCachedObject('a')).toEqual(sealed);
  });

  it('is a miss, not an error, for something it never held', async () => {
    originPrivateFileSystem();

    expect(await readCachedObject('missing')).toBeUndefined();
  });

  it('forgets what it is told to drop', async () => {
    originPrivateFileSystem();
    await writeCachedObject('a', new Uint8Array([1]));

    await dropCachedObject('a');

    expect(await readCachedObject('a')).toBeUndefined();
  });

  it('keeps only what the drive still lists', async () => {
    originPrivateFileSystem();
    await writeCachedObject('keep', new Uint8Array([1]));
    await writeCachedObject('gone', new Uint8Array([2]));

    expect(await pruneCachedObjects(new Set(['keep']))).toBe(1);
    expect(await cachedObjectIds()).toEqual(['keep']);
  });

  it('leaves nothing half-written when the disk refuses', async () => {
    originPrivateFileSystem({ failWrites: true });

    expect(await writeCachedObject('a', new Uint8Array([1]))).toBe(false);
    expect(await readCachedObject('a')).toBeUndefined();
  });
});

describe('a browser without an origin private file system', () => {
  it('reads as a permanent miss rather than throwing', async () => {
    vi.stubGlobal('navigator', {});

    expect(await readCachedObject('a')).toBeUndefined();
    expect(await cachedObjectIds()).toEqual([]);
    expect(await pruneCachedObjects(new Set())).toBe(0);
  });

  it('reports that a write did not happen, so nothing assumes it did', async () => {
    vi.stubGlobal('navigator', {});

    expect(await writeCachedObject('a', new Uint8Array([1]))).toBe(false);
  });

  it('does not throw when asked to drop something', async () => {
    vi.stubGlobal('navigator', {});

    await expect(dropCachedObject('a')).resolves.toBeUndefined();
  });
});
