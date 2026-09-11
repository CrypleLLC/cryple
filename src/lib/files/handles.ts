const DATABASE_NAME = 'cryple-drive';
const DATABASE_VERSION = 1;
const SOURCE_STORE = 'upload-sources';

export type SourcePermission = 'granted' | 'denied' | 'prompt';

interface PermissionDescriptor {
  mode: 'read' | 'readwrite';
}

interface HandleWithPermission extends FileSystemFileHandle {
  queryPermission?: (descriptor: PermissionDescriptor) => Promise<SourcePermission>;
  requestPermission?: (descriptor: PermissionDescriptor) => Promise<SourcePermission>;
}

interface FilePickerWindow {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
}

interface HandleTransfer {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

export interface RememberedSource {
  id: string;
  handle: FileSystemFileHandle;
  name: string;
  rememberedAt: string;
}

export interface UploadSource {
  file: File;
  handle?: FileSystemFileHandle;
}

export async function chooseSources(multiple: boolean): Promise<UploadSource[] | undefined> {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (picker === undefined) {
    return undefined;
  }

  let handles: FileSystemFileHandle[];
  try {
    handles = await picker({ multiple });
  } catch {
    return [];
  }

  return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
}

export async function droppedSources(transfer: DataTransfer): Promise<UploadSource[]> {
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  const sources = await Promise.all(
    items.map(async (item): Promise<UploadSource | undefined> => {
      const file = item.getAsFile();
      if (file === null) {
        return undefined;
      }

      const handle = await asFileHandle(item);
      return handle === undefined ? { file } : { file, handle };
    }),
  );

  const kept = sources.filter((source): source is UploadSource => source !== undefined);

  return kept.length > 0 ? kept : [...transfer.files].map((file) => ({ file }));
}

async function asFileHandle(item: DataTransferItem): Promise<FileSystemFileHandle | undefined> {
  const getHandle = (item as DataTransferItem & HandleTransfer).getAsFileSystemHandle;
  if (getHandle === undefined) {
    return undefined;
  }

  try {
    const handle = await getHandle.call(item);
    return handle !== null && handle.kind === 'file' ? (handle as FileSystemFileHandle) : undefined;
  } catch {
    return undefined;
  }
}

export async function rememberSource(id: string, handle: FileSystemFileHandle): Promise<void> {
  const remembered: RememberedSource = {
    id,
    handle,
    name: handle.name,
    rememberedAt: new Date().toISOString(),
  };

  await write((store) => store.put(remembered, id));
}

export async function recallSource(id: string): Promise<FileSystemFileHandle | undefined> {
  const remembered = await read<RememberedSource | undefined>((store) => store.get(id));

  return remembered?.handle;
}

export async function rememberedSourceIds(): Promise<string[]> {
  const keys = await read<IDBValidKey[]>((store) => store.getAllKeys());

  return keys === undefined ? [] : keys.map(String);
}

export async function forgetSource(id: string): Promise<void> {
  await write((store) => store.delete(id));
}

export async function forgetSourcesExcept(keep: readonly string[]): Promise<void> {
  const kept = new Set(keep);
  const stale = (await rememberedSourceIds()).filter((id) => !kept.has(id));

  await Promise.all(stale.map((id) => forgetSource(id)));
}

export async function openRememberedSource(
  handle: FileSystemFileHandle,
): Promise<File | undefined> {
  const permission = await grantRead(handle);
  if (permission !== 'granted') {
    return undefined;
  }

  try {
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

async function grantRead(handle: FileSystemFileHandle): Promise<SourcePermission> {
  const candidate = handle as HandleWithPermission;
  if (candidate.queryPermission === undefined || candidate.requestPermission === undefined) {
    return 'granted';
  }

  try {
    const current = await candidate.queryPermission({ mode: 'read' });
    if (current === 'granted') {
      return current;
    }

    return await candidate.requestPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

async function open(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    return undefined;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SOURCE_STORE)) {
        request.result.createObjectStore(SOURCE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
}

async function read<T>(run: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const database = await open();
  if (database === undefined) {
    return undefined;
  }

  return new Promise((resolve) => {
    const request = run(database.transaction(SOURCE_STORE, 'readonly').objectStore(SOURCE_STORE));
    request.onsuccess = () => {
      resolve(request.result as T);
      database.close();
    };
    request.onerror = () => {
      resolve(undefined);
      database.close();
    };
  });
}

async function write(run: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  const database = await open();
  if (database === undefined) {
    return;
  }

  return new Promise((resolve) => {
    const transaction = database.transaction(SOURCE_STORE, 'readwrite');
    run(transaction.objectStore(SOURCE_STORE));
    transaction.oncomplete = () => {
      resolve();
      database.close();
    };
    transaction.onerror = () => {
      resolve();
      database.close();
    };
    transaction.onabort = () => {
      resolve();
      database.close();
    };
  });
}
