import { isDeviceRecord, type DeviceRecord } from './record';

export interface DeviceRecordStore {
  read(): Promise<DeviceRecord | undefined>;
  write(record: DeviceRecord): Promise<void>;
  remove(): Promise<void>;
}

export const DEVICE_DATABASE = 'cryple-device';
export const DEVICE_OBJECT_STORE = 'device';
export const DEVICE_RECORD_KEY = 'current';

export function memoryDeviceStore(initial?: DeviceRecord): DeviceRecordStore {
  let record = initial;
  return {
    read: async () => record,
    write: async (next) => {
      record = next;
    },
    remove: async () => {
      record = undefined;
    },
  };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DEVICE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DEVICE_OBJECT_STORE)) {
        request.result.createObjectStore(DEVICE_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(DEVICE_OBJECT_STORE, mode);
      const request = run(transaction.objectStore(DEVICE_OBJECT_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function indexedDbDeviceStore(factory: IDBFactory = indexedDB): DeviceRecordStore {
  return {
    read: async () => {
      const value = await transact<unknown>(factory, 'readonly', (store) =>
        store.get(DEVICE_RECORD_KEY),
      );
      return isDeviceRecord(value) ? value : undefined;
    },
    write: async (record) => {
      await transact(factory, 'readwrite', (store) => store.put(record, DEVICE_RECORD_KEY));
    },
    remove: async () => {
      await transact(factory, 'readwrite', (store) => store.delete(DEVICE_RECORD_KEY));
    },
  };
}

export function browserDeviceStore(): DeviceRecordStore {
  if (typeof indexedDB === 'undefined') {
    return memoryDeviceStore();
  }
  return indexedDbDeviceStore(indexedDB);
}
