import { ApiError } from '@/lib/api';
import type { AuthedContext } from '@/lib/context';
import { bytesToUtf8, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { refreshKeyrings } from '@/lib/keyrings/api';
import { openBlob, sealBlob } from '@/lib/sealed';
import type { SessionKeystore } from '@/lib/session';
import { getAddressBook, putAddressBook, type AddressBookRecord } from './api';

export const ADDRESS_BOOK_VERSION = 1;
export const MAX_ADDRESS_BOOK_ATTEMPTS = 4;

export interface RootPin {
  root_public_key: string;
  pinned_at: string;
}

export interface NamedEntry {
  name: string;
  updated_at: string;
}

export interface AddressBook {
  v: typeof ADDRESS_BOOK_VERSION;
  pins: Record<string, RootPin>;
  nicknames: Record<string, NamedEntry>;
  devices: Record<string, NamedEntry>;
}

export class AddressBookFormatError extends Error {
  constructor() {
    super('the address book did not decode as a known version');
    this.name = 'AddressBookFormatError';
  }
}

export function emptyAddressBook(): AddressBook {
  return { v: ADDRESS_BOOK_VERSION, pins: {}, nicknames: {}, devices: {} };
}

export function parseAddressBook(text: string): AddressBook {
  const parsed = JSON.parse(text) as Partial<AddressBook>;
  if (parsed.v !== ADDRESS_BOOK_VERSION) {
    throw new AddressBookFormatError();
  }
  return {
    v: ADDRESS_BOOK_VERSION,
    pins: { ...(parsed.pins ?? {}) },
    nicknames: { ...(parsed.nicknames ?? {}) },
    devices: { ...(parsed.devices ?? {}) },
  };
}

function laterEntry(a: NamedEntry | undefined, b: NamedEntry | undefined): NamedEntry | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return b.updated_at > a.updated_at ? b : a;
}

function mergeNamed(
  base: Record<string, NamedEntry>,
  incoming: Record<string, NamedEntry>,
): Record<string, NamedEntry> {
  const merged: Record<string, NamedEntry> = { ...base };
  for (const [id, entry] of Object.entries(incoming)) {
    const winner = laterEntry(merged[id], entry);
    if (winner !== undefined) {
      merged[id] = winner;
    }
  }
  return merged;
}

export function mergeAddressBooks(stored: AddressBook, local: AddressBook): AddressBook {
  const pins: Record<string, RootPin> = { ...local.pins, ...stored.pins };
  return {
    v: ADDRESS_BOOK_VERSION,
    pins,
    nicknames: mergeNamed(stored.nicknames, local.nicknames),
    devices: mergeNamed(stored.devices, local.devices),
  };
}

export type AddressBookEdit = (book: AddressBook) => AddressBook;

export function setNickname(connectionId: string, name: string, at = new Date()): AddressBookEdit {
  return (book) => ({
    ...book,
    nicknames: { ...book.nicknames, [connectionId]: { name: name.trim(), updated_at: at.toISOString() } },
  });
}

export function setDeviceName(deviceId: string, name: string, at = new Date()): AddressBookEdit {
  return (book) => ({
    ...book,
    devices: { ...book.devices, [deviceId]: { name: name.trim(), updated_at: at.toISOString() } },
  });
}

export function pinRoot(userAddress: string, rootPublicKey: string, at = new Date()): AddressBookEdit {
  return (book) =>
    book.pins[userAddress] !== undefined
      ? book
      : {
          ...book,
          pins: {
            ...book.pins,
            [userAddress]: { root_public_key: rootPublicKey, pinned_at: at.toISOString() },
          },
        };
}

export function displayName(entry: NamedEntry | undefined): string | undefined {
  const name = entry?.name.trim();
  return name === undefined || name === '' ? undefined : name;
}

interface LoadedBook {
  book: AddressBook;
  revision: number;
}

async function openRecord(context: AuthedContext, record: AddressBookRecord): Promise<AddressBook> {
  const kek = await sharingKek(context, record.key_generation);
  const dek = await openBlob(record.wrapped_dek, kek);
  try {
    const plaintext = await openBlob(record.ciphertext, dek);
    try {
      return parseAddressBook(bytesToUtf8(plaintext));
    } finally {
      zeroBytes(plaintext);
    }
  } finally {
    zeroBytes(dek);
  }
}

async function sharingKek(context: AuthedContext, generation: number): Promise<Uint8Array> {
  if (!context.session.hasKek('sharing', generation)) {
    await refreshKeyrings(context);
  }
  return context.session.kek('sharing', generation);
}

async function sealBook(context: AuthedContext, book: AddressBook) {
  const { generation, kek } = context.session.currentKek('sharing');
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = utf8ToBytes(JSON.stringify(book));
  try {
    return {
      ciphertext: await sealBlob(plaintext, dek),
      wrapped_dek: await sealBlob(dek, kek),
      key_generation: generation,
    };
  } finally {
    zeroBytes(dek, plaintext);
  }
}

const cache = new WeakMap<SessionKeystore, { loaded?: LoadedBook }>();

function sessionCache(session: SessionKeystore): { loaded?: LoadedBook } {
  let entry = cache.get(session);
  if (entry === undefined) {
    const created: { loaded?: LoadedBook } = {};
    session.onLock(() => {
      created.loaded = undefined;
    });
    cache.set(session, created);
    entry = created;
  }
  return entry;
}

export async function loadAddressBook(
  context: AuthedContext,
  options: { fresh?: boolean } = {},
): Promise<AddressBook> {
  const holder = sessionCache(context.session);
  if (!options.fresh && holder.loaded !== undefined) {
    return holder.loaded.book;
  }
  const record = await getAddressBook(context);
  const loaded: LoadedBook =
    record === undefined
      ? { book: emptyAddressBook(), revision: 0 }
      : { book: await openRecord(context, record), revision: record.revision };
  holder.loaded = loaded;
  return loaded.book;
}

export async function editAddressBook(
  context: AuthedContext,
  edit: AddressBookEdit,
): Promise<AddressBook> {
  const holder = sessionCache(context.session);
  let fresh = holder.loaded === undefined;

  for (let attempt = 0; attempt < MAX_ADDRESS_BOOK_ATTEMPTS; attempt += 1) {
    if (fresh || holder.loaded === undefined) {
      await loadAddressBook(context, { fresh: true });
    }
    const loaded = holder.loaded as LoadedBook;
    const next = edit(loaded.book);
    if (next === loaded.book) {
      return loaded.book;
    }

    try {
      const stored = await putAddressBook(context, {
        ...(await sealBook(context, next)),
        expected_revision: loaded.revision,
      });
      holder.loaded = { book: next, revision: stored.revision };
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.isStaleKeyGeneration) {
        await refreshKeyrings(context);
        fresh = false;
        continue;
      }
      if (error instanceof ApiError && error.status === 409) {
        fresh = true;
        continue;
      }
      throw error;
    }
  }

  throw new Error('the address book kept changing on another device; try again');
}
