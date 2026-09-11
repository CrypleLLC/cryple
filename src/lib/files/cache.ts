const CACHE_DIRECTORY = 'objects';

interface CacheWritable {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}

interface CacheFile {
  getFile: () => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
  createWritable: () => Promise<CacheWritable>;
}

interface CacheDirectory {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<CacheFile>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<CacheDirectory>;
  removeEntry: (name: string) => Promise<void>;
  keys: () => AsyncIterableIterator<string>;
}

interface OriginStorage {
  storage?: { getDirectory?: () => Promise<CacheDirectory> };
}

async function objects(create: boolean): Promise<CacheDirectory | undefined> {
  const storage = (globalThis.navigator as unknown as OriginStorage | undefined)?.storage;
  if (storage?.getDirectory === undefined) {
    return undefined;
  }

  try {
    const root = await storage.getDirectory();

    return await root.getDirectoryHandle(CACHE_DIRECTORY, { create });
  } catch {
    return undefined;
  }
}

export async function readCachedObject(id: string): Promise<Uint8Array | undefined> {
  const directory = await objects(false);
  if (directory === undefined) {
    return undefined;
  }

  try {
    const handle = await directory.getFileHandle(id);
    const file = await handle.getFile();

    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return undefined;
  }
}

export async function writeCachedObject(id: string, sealed: Uint8Array): Promise<boolean> {
  const directory = await objects(true);
  if (directory === undefined) {
    return false;
  }

  try {
    const handle = await directory.getFileHandle(id, { create: true });
    const writable = await handle.createWritable();
    await writable.write(sealed);
    await writable.close();

    return true;
  } catch {
    await dropCachedObject(id);

    return false;
  }
}

export async function dropCachedObject(id: string): Promise<void> {
  const directory = await objects(false);
  if (directory === undefined) {
    return;
  }

  try {
    await directory.removeEntry(id);
  } catch {
    return;
  }
}

export async function cachedObjectIds(): Promise<string[]> {
  const directory = await objects(false);
  if (directory === undefined) {
    return [];
  }

  const ids: string[] = [];
  try {
    for await (const name of directory.keys()) {
      ids.push(name);
    }
  } catch {
    return [];
  }

  return ids;
}

export async function pruneCachedObjects(keep: ReadonlySet<string>): Promise<number> {
  const stale = (await cachedObjectIds()).filter((id) => !keep.has(id));
  for (const id of stale) {
    await dropCachedObject(id);
  }

  return stale.length;
}
