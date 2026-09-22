import { ApiError } from '@/lib/api';
import type { AuthedContext } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { refreshKeyrings } from '@/lib/keyrings/api';
import { deriveShareSubkey } from '@/lib/keyrings/crypto';
import { getSecret, createSecret } from '@/lib/secrets';
import { getNote, createNote } from '@/lib/notes';
import { getDocument, createDocumentFromSnapshot, openUpdate } from '@/lib/documents';
import {
  decryptStream,
  getFileDownload,
  openManifest,
  uploadFile,
  type FileManifest,
} from '@/lib/files';
import { openBlob, openText, sealBlob } from '@/lib/sealed';
import { ITEM_SCOPES, scopeForItemType, type ItemScope } from '@/lib/scopes';
import { resolveUsername } from '@/lib/users';
import {
  createConnectionKey,
  openConnectionKey,
  publishedRecipientKeys,
  sealConnectionKey,
  unwrapUnderConnection,
  wrapUnderConnection,
} from './keys';
import {
  acceptConnection,
  createConnection,
  createShare,
  getSharedDownload,
  getSharedItem,
  putConnectionKeys,
  type ConnectionKeyRecord,
  type ConnectionRecord,
  type InboundShareRecord,
  type ItemType,
} from './api';
import {
  ConnectionNotTrustedError,
  assertConnectionTrusted,
  fetchPublishedCounterparty,
  judgeCounterparty,
  publishedCounterparty,
  type PublishedCounterparty,
} from './verify';

export class UnknownRecipientError extends Error {
  constructor(username: string) {
    super(`no account currently uses the username "${username}"`);
    this.name = 'UnknownRecipientError';
  }
}

export class ConnectionNotOpenableError extends Error {
  constructor() {
    super('this connection cannot be opened with your keys');
    this.name = 'ConnectionNotOpenableError';
  }
}

export class ScopeNotSharedError extends Error {
  constructor(scope: string) {
    super(`this connection holds no sub-key for ${scope} on this side`);
    this.name = 'ScopeNotSharedError';
  }
}

export class AlreadyConnectedError extends Error {
  constructor(username: string) {
    super(`this account is already connected to "${username}"`);
    this.name = 'AlreadyConnectedError';
  }
}

export class NothingToCopyError extends Error {
  constructor() {
    super('the shared document has no saved snapshot yet, so there is nothing to copy');
    this.name = 'NothingToCopyError';
  }
}

export interface InvitationDraft {
  connection: ConnectionRecord;
  fingerprint: string;
}

export function sharableScopes(context: AuthedContext): ItemScope[] {
  return ITEM_SCOPES.filter((scope) => context.session.holds(scope));
}

export function sharableItemTypes(context: AuthedContext): ItemType[] {
  return (['secret', 'note', 'document', 'file'] as const).filter((type) =>
    context.session.holds(scopeForItemType(type)),
  );
}

async function sealSubkeys(
  context: AuthedContext,
  connectionKey: Uint8Array,
): Promise<ConnectionKeyRecord[]> {
  const keys: ConnectionKeyRecord[] = [];
  for (const scope of sharableScopes(context)) {
    const subkey = await deriveShareSubkey(connectionKey, scope);
    try {
      const { generation, kek } = context.session.currentKek(scope);
      keys.push({ scope, key_generation: generation, wrapped_key: await sealBlob(subkey, kek) });
    } finally {
      zeroBytes(subkey);
    }
  }
  return keys;
}

export async function storeSubkeys(
  context: AuthedContext,
  connectionId: string,
  connectionKey: Uint8Array,
): Promise<ConnectionKeyRecord[]> {
  for (let attempt = 0; ; attempt += 1) {
    const keys = await sealSubkeys(context, connectionKey);
    try {
      await putConnectionKeys(context, connectionId, keys);
      return keys;
    } catch (error) {
      if (attempt === 0 && error instanceof ApiError && error.isStaleKeyGeneration) {
        await refreshKeyrings(context);
        continue;
      }
      throw error;
    }
  }
}

async function encapsulateTo(
  context: AuthedContext,
  published: PublishedCounterparty,
  username: string,
) {
  const connectionKey = createConnectionKey();
  try {
    const pqxdhBlob = await sealConnectionKey(
      connectionKey,
      publishedRecipientKeys(published.sharingKeys),
      context.session.userAddress,
      published.userAddress,
    );
    const { generation, kek } = context.session.currentKek('sharing');
    const connection = await createConnection(context, {
      recipientUsername: username,
      pqxdhBlob,
      senderWrappedKey: await sealBlob(connectionKey, kek),
      senderKeyGeneration: generation,
      recipientKeyGeneration: published.sharingKeys.generation,
    });
    return { connection, connectionKey };
  } catch (error) {
    zeroBytes(connectionKey);
    throw error;
  }
}

export function connectionWith(
  connections: readonly ConnectionRecord[],
  username: string,
): ConnectionRecord | undefined {
  const wanted = username.trim().toLowerCase();
  return connections.find((connection) => connection.username === wanted);
}

export async function inviteByUsername(
  context: AuthedContext,
  username: string,
  existing: readonly ConnectionRecord[] = [],
): Promise<InvitationDraft> {
  context.session.requireScope('sharing');
  if (connectionWith(existing, username) !== undefined) {
    throw new AlreadyConnectedError(username);
  }
  const resolved = await resolveUsername(context, username);
  if (!resolved) {
    throw new UnknownRecipientError(username);
  }
  if (connectionWith(existing, resolved.username) !== undefined) {
    throw new AlreadyConnectedError(resolved.username);
  }

  let published = await fetchPublishedCounterparty(context, resolved.username);
  if (published === undefined) {
    throw new UnknownRecipientError(username);
  }
  const trust = await judgeCounterparty(context, published, { mayPin: true });
  if (trust.status !== 'trusted') {
    throw new ConnectionNotTrustedError({ id: 'new' }, trust);
  }

  let made;
  try {
    made = await encapsulateTo(context, published, resolved.username);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === 'CONFLICT') {
      throw new AlreadyConnectedError(resolved.username);
    }
    if (!(error instanceof ApiError && error.isStaleKeyGeneration)) {
      throw error;
    }
    await refreshKeyrings(context);
    published = await fetchPublishedCounterparty(context, resolved.username);
    if (published === undefined) {
      throw new UnknownRecipientError(username);
    }
    const again = await judgeCounterparty(context, published, { mayPin: true });
    if (again.status !== 'trusted') {
      throw new ConnectionNotTrustedError({ id: 'new' }, again);
    }
    made = await encapsulateTo(context, published, resolved.username);
  }

  try {
    const keys = await storeSubkeys(context, made.connection.id, made.connectionKey);
    return { connection: { ...made.connection, keys }, fingerprint: published.fingerprint };
  } finally {
    zeroBytes(made.connectionKey);
  }
}

export async function connectionKeyFor(
  context: AuthedContext,
  connection: ConnectionRecord,
): Promise<Uint8Array> {
  context.session.requireScope('sharing');
  if (connection.direction === 'outbound') {
    if (!connection.sender_wrapped_key) {
      throw new ConnectionNotOpenableError();
    }
    if (!context.session.hasKek('sharing', connection.sender_key_generation)) {
      await refreshKeyrings(context);
    }
    return openBlob(
      connection.sender_wrapped_key,
      context.session.kek('sharing', connection.sender_key_generation),
    );
  }

  if (!connection.pqxdh_blob) {
    throw new ConnectionNotOpenableError();
  }
  if (!context.session.hasKek('sharing', connection.recipient_key_generation)) {
    await refreshKeyrings(context);
  }
  const sharing = await context.session.sharingKeys(connection.recipient_key_generation);
  return openConnectionKey(
    connection.pqxdh_blob,
    { x25519PrivateKey: sharing.x25519PrivateKey, mlkemSecretKey: sharing.mlkemSecretKey },
    connection.user_address,
    context.session.userAddress,
  );
}

export async function acceptInvitation(
  context: AuthedContext,
  connection: ConnectionRecord,
): Promise<void> {
  const connectionKey = await connectionKeyFor(context, connection);
  try {
    await storeSubkeys(context, connection.id, connectionKey);
  } finally {
    zeroBytes(connectionKey);
  }
  await acceptConnection(context, connection.id);

  const published = await publishedCounterparty(context, connection);
  if (published !== undefined && published.userAddress === connection.user_address) {
    await judgeCounterparty(context, published, { mayPin: true });
  }
}

export async function shareSubkey(
  context: AuthedContext,
  connection: ConnectionRecord,
  scope: ItemScope,
): Promise<Uint8Array> {
  context.session.requireScope(scope);
  const stored = connection.keys.find((key) => key.scope === scope);
  if (stored !== undefined) {
    if (!context.session.hasKek(scope, stored.key_generation)) {
      await refreshKeyrings(context);
    }
    return openBlob(stored.wrapped_key, context.session.kek(scope, stored.key_generation));
  }

  if (!context.session.holds('sharing')) {
    throw new ScopeNotSharedError(scope);
  }
  const connectionKey = await connectionKeyFor(context, connection);
  try {
    const keys = await storeSubkeys(context, connection.id, connectionKey);
    connection.keys = keys;
    return await deriveShareSubkey(connectionKey, scope);
  } finally {
    zeroBytes(connectionKey);
  }
}

export async function shareItem(
  context: AuthedContext,
  connection: ConnectionRecord,
  item: { type: ItemType; id: string; dek: Uint8Array },
): Promise<void> {
  await assertConnectionTrusted(context, connection);
  await sendUnderConnection(context, connection, item);
}

async function sendUnderConnection(
  context: AuthedContext,
  connection: ConnectionRecord,
  item: { type: ItemType; id: string; dek: Uint8Array },
): Promise<void> {
  const subkey = await shareSubkey(context, connection, scopeForItemType(item.type));
  try {
    await createShare(context, {
      connectionId: connection.id,
      itemType: item.type,
      itemId: item.id,
      wrappedDek: await wrapUnderConnection(subkey, item.dek),
    });
  } finally {
    zeroBytes(subkey);
  }
}

export async function itemDek(
  context: AuthedContext,
  itemType: ItemType,
  itemId: string,
): Promise<Uint8Array> {
  const scope = scopeForItemType(itemType);
  const record = await wrappedDekFor(context, itemType, itemId);
  if (!context.session.hasKek(scope, record.key_generation)) {
    await refreshKeyrings(context);
  }
  return openBlob(record.wrapped_dek, context.session.kek(scope, record.key_generation));
}

async function wrappedDekFor(
  context: AuthedContext,
  itemType: ItemType,
  itemId: string,
): Promise<{ wrapped_dek: string; key_generation: number }> {
  switch (itemType) {
    case 'secret':
      return getSecret(context, itemId);
    case 'note':
      return getNote(context, itemId);
    case 'document':
      return getDocument(context, itemId);
    case 'file':
      return getFileDownload(context, itemId);
  }
}

export async function shareItemById(
  context: AuthedContext,
  connection: ConnectionRecord,
  itemType: ItemType,
  itemId: string,
): Promise<void> {
  await assertConnectionTrusted(context, connection);
  const dek = await itemDek(context, itemType, itemId);
  try {
    await sendUnderConnection(context, connection, { type: itemType, id: itemId, dek });
  } finally {
    dek.fill(0);
  }
}

export async function sharedItemDek(
  context: AuthedContext,
  connection: ConnectionRecord,
  share: Pick<InboundShareRecord, 'item_type' | 'wrapped_dek'>,
): Promise<Uint8Array> {
  if (!share.wrapped_dek) {
    throw new ConnectionNotOpenableError();
  }
  const subkey = await shareSubkey(context, connection, scopeForItemType(share.item_type));
  try {
    return await unwrapUnderConnection(subkey, share.wrapped_dek);
  } finally {
    zeroBytes(subkey);
  }
}

export async function openSharedItem(
  context: AuthedContext,
  connection: ConnectionRecord,
  shareId: string,
): Promise<{ ciphertext: string; dek: Uint8Array; itemType: ItemType }> {
  const shared = await getSharedItem(context, shareId);
  return {
    ciphertext: shared.ciphertext,
    dek: await sharedItemDek(context, connection, shared),
    itemType: shared.item_type,
  };
}

export interface SharedFile {
  manifest: FileManifest;
  bytes: Uint8Array;
}

export async function openSharedFile(
  context: AuthedContext,
  connection: ConnectionRecord,
  shareId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SharedFile> {
  const shared = await getSharedItem(context, shareId);
  const download = await getSharedDownload(context, shareId);
  let dek: Uint8Array | undefined;
  try {
    dek = await sharedItemDek(context, connection, {
      item_type: 'file',
      wrapped_dek: download.wrapped_dek,
    });
    const manifest = await openManifest(shared.ciphertext, dek);
    const response = await fetchImpl(download.url);
    if (!response.ok || response.body === null) {
      throw new Error(`the object store answered ${response.status} for this file`);
    }
    const plaintext = decryptStream(response.body, manifest, dek);
    return { manifest, bytes: await collectStream(plaintext, manifest.size) };
  } finally {
    dek?.fill(0);
  }
}

export async function openSharedText(
  context: AuthedContext,
  connection: ConnectionRecord,
  shareId: string,
): Promise<string> {
  const { ciphertext, dek } = await openSharedItem(context, connection, shareId);
  try {
    return await openText(ciphertext, dek);
  } finally {
    dek.fill(0);
  }
}

export interface CopiedItem {
  type: ItemType;
  id: string;
}

export async function copySharedItem(
  context: AuthedContext,
  connection: ConnectionRecord,
  share: Pick<InboundShareRecord, 'id' | 'item_type'>,
  fetchImpl: typeof fetch = fetch,
): Promise<CopiedItem> {
  context.session.requireScope(scopeForItemType(share.item_type));

  switch (share.item_type) {
    case 'secret': {
      const plaintext = await openSharedText(context, connection, share.id);
      const { secret } = await createSecret(context, plaintext);
      return { type: 'secret', id: secret.id };
    }
    case 'note': {
      const plaintext = await openSharedText(context, connection, share.id);
      const { note } = await createNote(context, plaintext);
      return { type: 'note', id: note.id };
    }
    case 'document': {
      const { ciphertext, dek } = await openSharedItem(context, connection, share.id);
      let snapshot: Uint8Array | undefined;
      try {
        if (ciphertext === '') {
          throw new NothingToCopyError();
        }
        snapshot = await openUpdate(ciphertext, dek);
        const document = await createDocumentFromSnapshot(context, snapshot);
        return { type: 'document', id: document.id };
      } finally {
        dek.fill(0);
        snapshot?.fill(0);
      }
    }
    case 'file': {
      const { manifest, bytes } = await openSharedFile(context, connection, share.id, fetchImpl);
      try {
        const record = await uploadFile(context, {
          name: manifest.name,
          type: manifest.mime,
          size: bytes.length,
          stream: () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes.slice());
                controller.close();
              },
            }),
        });
        return { type: 'file', id: record.id };
      } finally {
        bytes.fill(0);
      }
    }
  }
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  size: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(size);
  const reader = stream.getReader();
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out.set(value, offset);
    offset += value.length;
  }
  return out;
}
