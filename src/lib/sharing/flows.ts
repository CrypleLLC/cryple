import { getPublicKeys, resolveUsername } from '@/lib/users';
import { getSecret, vaultKekDekWrapper } from '@/lib/secrets';
import { getNote } from '@/lib/notes';
import { getDocument } from '@/lib/documents';
import { decryptStream, getFileDownload, openManifest, type FileManifest } from '@/lib/files';
import { openText } from '@/lib/sealed';
import type { AuthedContext } from '@/lib/context';
import {
  createConnectionKey,
  keyFingerprint,
  openConnectionKey,
  publishedRecipientKeys,
  sealConnectionKey,
  unwrapUnderConnection,
  wrapUnderConnection,
} from './keys';
import {
  createConnection,
  createShare,
  getSharedDownload,
  getSharedItem,
  type ConnectionRecord,
  type ItemType,
} from './api';
import { fingerprintPinOptions, pinFingerprint } from './pins';
import { assertConnectionTrusted } from './verify';

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

export interface InvitationDraft {
  connection: ConnectionRecord;
  fingerprint: string;
}

export async function inviteByUsername(
  context: AuthedContext,
  username: string,
): Promise<InvitationDraft> {
  const resolved = await resolveUsername(context, username);
  if (!resolved) {
    throw new UnknownRecipientError(username);
  }

  const published = await getPublicKeys(context, resolved.uuid);
  const keys = publishedRecipientKeys(published);

  const connectionKey = createConnectionKey();
  try {
    const pqxdhBlob = await sealConnectionKey(
      connectionKey,
      keys,
      context.session.userAddress,
      published.user_address,
    );
    const senderWrappedKey = await vaultKekDekWrapper(context.session.vaultKek).wrapDek(
      connectionKey,
    );

    const connection = await createConnection(context, {
      recipientUsername: resolved.username,
      pqxdhBlob,
      senderWrappedKey,
    });

    const fingerprint = await keyFingerprint(keys);
    await pinFingerprint(connection.id, fingerprint, fingerprintPinOptions(context)).catch(
      () => undefined,
    );

    return { connection, fingerprint };
  } finally {
    connectionKey.fill(0);
  }
}

export async function connectionKeyFor(
  context: AuthedContext,
  connection: ConnectionRecord,
  counterpartyUserAddress: string,
): Promise<Uint8Array> {
  if (connection.direction === 'outbound') {
    if (!connection.sender_wrapped_key) {
      throw new ConnectionNotOpenableError();
    }

    return vaultKekDekWrapper(context.session.vaultKek).unwrapDek(connection.sender_wrapped_key);
  }

  if (!connection.pqxdh_blob) {
    throw new ConnectionNotOpenableError();
  }

  return openConnectionKey(
    connection.pqxdh_blob,
    {
      x25519PrivateKey: context.session.x25519PrivateKey,
      mlkemSecretKey: context.session.mlkem768SecretKey,
    },
    counterpartyUserAddress,
    context.session.userAddress,
  );
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
  const connectionKey = await connectionKeyFor(context, connection, connection.user_address);
  try {
    await createShare(context, {
      connectionId: connection.id,
      itemType: item.type,
      itemId: item.id,
      wrappedDek: await wrapUnderConnection(connectionKey, item.dek),
    });
  } finally {
    connectionKey.fill(0);
  }
}

export async function openSharedItem(
  context: AuthedContext,
  connection: ConnectionRecord,
  shareId: string,
  senderUserAddress: string,
): Promise<{ ciphertext: string; dek: Uint8Array }> {
  const shared = await getSharedItem(context, shareId);
  if (!shared.wrapped_dek) {
    throw new ConnectionNotOpenableError();
  }

  const connectionKey = await connectionKeyFor(context, connection, senderUserAddress);
  try {
    return {
      ciphertext: shared.ciphertext,
      dek: await unwrapUnderConnection(connectionKey, shared.wrapped_dek),
    };
  } finally {
    connectionKey.fill(0);
  }
}

export async function ownKeyFingerprint(context: AuthedContext): Promise<string> {
  return keyFingerprint({
    x25519PublicKey: context.session.x25519PublicKey,
    mlkemPublicKey: context.session.mlkem768PublicKey,
  });
}

export async function itemDek(
  context: AuthedContext,
  itemType: ItemType,
  itemId: string,
): Promise<Uint8Array> {
  const wrapped = await wrappedDekFor(context, itemType, itemId);

  return vaultKekDekWrapper(context.session.vaultKek).unwrapDek(wrapped);
}

async function wrappedDekFor(
  context: AuthedContext,
  itemType: ItemType,
  itemId: string,
): Promise<string> {
  switch (itemType) {
    case 'secret':
      return (await getSecret(context, itemId)).wrapped_dek;
    case 'note':
      return (await getNote(context, itemId)).wrapped_dek;
    case 'document':
      return (await getDocument(context, itemId)).wrapped_dek;
    case 'file':
      return (await getFileDownload(context, itemId)).wrapped_dek;
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

  const connectionKey = await connectionKeyFor(context, connection, connection.user_address);
  let dek: Uint8Array | undefined;

  try {
    dek = await unwrapUnderConnection(connectionKey, download.wrapped_dek);
    const manifest = await openManifest(shared.ciphertext, dek);

    const response = await fetchImpl(download.url);
    if (!response.ok || response.body === null) {
      throw new Error(`the object store answered ${response.status} for this file`);
    }

    const plaintext = decryptStream(response.body, manifest, dek);

    return { manifest, bytes: await collectStream(plaintext, manifest.size) };
  } finally {
    connectionKey.fill(0);
    dek?.fill(0);
  }
}

export async function openSharedText(
  context: AuthedContext,
  connection: ConnectionRecord,
  shareId: string,
): Promise<string> {
  const { ciphertext, dek } = await openSharedItem(
    context,
    connection,
    shareId,
    connection.user_address,
  );

  try {
    return await openText(ciphertext, dek);
  } finally {
    dek.fill(0);
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
