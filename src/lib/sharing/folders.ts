import { ApiError } from '@/lib/api';
import type { AuthedContext } from '@/lib/context';
import { bytesToUtf8, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import {
  emptyFolderManifest,
  FolderEditError,
  mergeFolderManifests,
  parseFolderManifest,
  validateFolderManifest,
  MAX_TREE_DEPTH,
  type FolderEdit,
  type FolderManifest,
  type FolderRules,
} from '@/lib/folders';
import { openBlob, sealBlob } from '@/lib/sealed';
import type { SessionKeystore } from '@/lib/session';
import {
  getConnectionFolders,
  listConnections,
  putConnectionFolders,
  type ConnectionFoldersRecord,
  type ConnectionRecord,
} from './api';
import { connectionKeyFor, sharedFoldersSubkey } from './flows';
import { unwrapUnderConnection, wrapUnderConnection } from './keys';

export const SHARED_FOLDER_RULES: FolderRules = { maxDepth: MAX_TREE_DEPTH, home: false };
export const MAX_SHARED_FOLDERS_ATTEMPTS = 4;

export class ConnectionGoneError extends Error {
  constructor() {
    super('this connection no longer exists');
    this.name = 'ConnectionGoneError';
  }
}

interface LoadedSharedFolders {
  manifest: FolderManifest;
  revision: number;
  recipientKeyGeneration: number;
}

const cache = new WeakMap<SessionKeystore, Map<string, LoadedSharedFolders>>();

function sessionCache(session: SessionKeystore): Map<string, LoadedSharedFolders> {
  let entry = cache.get(session);
  if (entry === undefined) {
    const created = new Map<string, LoadedSharedFolders>();
    session.onLock(() => created.clear());
    cache.set(session, created);
    entry = created;
  }
  return entry;
}

function cachedFor(context: AuthedContext, connection: ConnectionRecord): LoadedSharedFolders | undefined {
  const cached = sessionCache(context.session).get(connection.id);
  return cached?.recipientKeyGeneration === connection.recipient_key_generation ? cached : undefined;
}

async function refreshConnection(context: AuthedContext, connection: ConnectionRecord): Promise<void> {
  const fresh = (await listConnections(context)).find((candidate) => candidate.id === connection.id);
  if (fresh === undefined) {
    throw new ConnectionGoneError();
  }
  Object.assign(connection, fresh);
}

async function subkeyFor(context: AuthedContext, connection: ConnectionRecord): Promise<Uint8Array> {
  const connectionKey = await connectionKeyFor(context, connection);
  try {
    return await sharedFoldersSubkey(connectionKey);
  } finally {
    zeroBytes(connectionKey);
  }
}

async function openRecord(
  context: AuthedContext,
  connection: ConnectionRecord,
  record: ConnectionFoldersRecord,
): Promise<FolderManifest> {
  if (record.recipient_key_generation !== connection.recipient_key_generation) {
    await refreshConnection(context, connection);
  }
  const subkey = await subkeyFor(context, connection);
  try {
    const dek = await unwrapUnderConnection(subkey, record.wrapped_dek);
    try {
      const plaintext = await openBlob(record.ciphertext, dek);
      try {
        return validateFolderManifest(parseFolderManifest(bytesToUtf8(plaintext)), SHARED_FOLDER_RULES);
      } finally {
        zeroBytes(plaintext);
      }
    } finally {
      zeroBytes(dek);
    }
  } finally {
    zeroBytes(subkey);
  }
}

async function sealManifest(context: AuthedContext, connection: ConnectionRecord, manifest: FolderManifest) {
  const subkey = await subkeyFor(context, connection);
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = utf8ToBytes(JSON.stringify(manifest));
  try {
    return {
      ciphertext: await sealBlob(plaintext, dek),
      wrapped_dek: await wrapUnderConnection(subkey, dek),
      recipient_key_generation: connection.recipient_key_generation,
    };
  } finally {
    zeroBytes(subkey, dek, plaintext);
  }
}

export async function loadSharedFolders(
  context: AuthedContext,
  connection: ConnectionRecord,
  options: { fresh?: boolean } = {},
): Promise<FolderManifest> {
  context.session.requireScope('sharing');
  const cached = cachedFor(context, connection);
  if (!options.fresh && cached !== undefined) {
    return cached.manifest;
  }
  const record = await getConnectionFolders(context, connection.id);
  const manifest =
    record === undefined
      ? emptyFolderManifest(SHARED_FOLDER_RULES)
      : await openRecord(context, connection, record);
  sessionCache(context.session).set(connection.id, {
    manifest,
    revision: record?.revision ?? 0,
    recipientKeyGeneration: connection.recipient_key_generation,
  });
  return manifest;
}

function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.isStaleKeyGeneration;
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

export async function editSharedFolders(
  context: AuthedContext,
  connection: ConnectionRecord,
  edit: FolderEdit,
): Promise<FolderManifest> {
  const holder = sessionCache(context.session);
  let fresh = cachedFor(context, connection) === undefined;

  for (let attempt = 0; attempt < MAX_SHARED_FOLDERS_ATTEMPTS; attempt += 1) {
    const reread = fresh || cachedFor(context, connection) === undefined;
    if (reread) {
      await loadSharedFolders(context, connection, { fresh: true });
    }
    const loaded = holder.get(connection.id) as LoadedSharedFolders;
    let edited: FolderManifest;
    try {
      edited = edit(loaded.manifest, SHARED_FOLDER_RULES);
    } catch (error) {
      if (error instanceof FolderEditError && !reread) {
        fresh = true;
        continue;
      }
      throw error;
    }
    if (edited === loaded.manifest) {
      return loaded.manifest;
    }
    const next = mergeFolderManifests(loaded.manifest, edited, SHARED_FOLDER_RULES);

    try {
      const stored = await putConnectionFolders(context, connection.id, {
        ...(await sealManifest(context, connection, next)),
        expected_revision: loaded.revision,
      });
      holder.set(connection.id, {
        manifest: next,
        revision: stored.revision,
        recipientKeyGeneration: stored.recipient_key_generation,
      });
      return next;
    } catch (error) {
      if (isStale(error)) {
        await refreshConnection(context, connection);
        fresh = true;
        continue;
      }
      if (isConflict(error)) {
        fresh = true;
        continue;
      }
      throw error;
    }
  }

  throw new Error('the shared folders kept changing on the other side; try again');
}

export async function resetSharedFolders(
  context: AuthedContext,
  connection: ConnectionRecord,
): Promise<FolderManifest> {
  context.session.requireScope('sharing');
  const manifest = emptyFolderManifest(SHARED_FOLDER_RULES);

  for (let attempt = 0; attempt < MAX_SHARED_FOLDERS_ATTEMPTS; attempt += 1) {
    const record = await getConnectionFolders(context, connection.id);
    try {
      const stored = await putConnectionFolders(context, connection.id, {
        ...(await sealManifest(context, connection, manifest)),
        expected_revision: record?.revision ?? 0,
      });
      sessionCache(context.session).set(connection.id, {
        manifest,
        revision: stored.revision,
        recipientKeyGeneration: stored.recipient_key_generation,
      });
      return manifest;
    } catch (error) {
      if (isStale(error)) {
        await refreshConnection(context, connection);
        continue;
      }
      if (isConflict(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('the shared folders kept changing on the other side; try again');
}
