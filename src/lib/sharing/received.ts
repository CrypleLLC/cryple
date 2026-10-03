import { fileKind, type FileKind } from '@/lib/app/files';
import { getFileDownload, openManifest } from '@/lib/files';
import { getNote } from '@/lib/notes';
import { getSecret } from '@/lib/secrets';
import { openText } from '@/lib/sealed';
import type { AuthedContext } from '@/lib/context';
import {
  getSharedItem,
  type ConnectionDirection,
  type ConnectionRecord,
  type ConnectionShareRecord,
  type InboundShareRecord,
  type ItemType,
} from './api';
import { sharedItemDek } from './flows';

export interface ReceivedItem {
  shareId: string;
  connectionId: string;
  itemType: InboundShareRecord['item_type'];
  itemId: string;
  direction: ConnectionDirection;
  counterparty: string;
  createdAt: string;
  name: string;
  readable: boolean;
  problem?: string;
  sizeBytes?: number;
  kind?: FileKind;
  mime?: string;
  text?: string;
}

export interface SharedTextView {
  name: string;
  body: string;
}

export const UNREADABLE_SHARED_NAME = 'Unreadable';

type TextView = (plaintext: string) => SharedTextView;

export function inboundShare(
  share: ConnectionShareRecord,
  connection: ConnectionRecord,
): InboundShareRecord {
  return {
    id: share.id,
    connection_id: connection.id,
    item_type: share.item_type,
    item_id: share.item_id,
    wrapped_dek: share.wrapped_dek,
    created_at: share.created_at,
    sender_username: connection.username,
  };
}

function unreadableBase(
  share: { id: string; item_type: ItemType; item_id: string; created_at: string },
  connectionId: string,
  direction: ConnectionDirection,
  counterparty: string,
): ReceivedItem {
  return {
    shareId: share.id,
    connectionId,
    itemType: share.item_type,
    itemId: share.item_id,
    direction,
    counterparty,
    createdAt: share.created_at,
    name: UNREADABLE_SHARED_NAME,
    readable: false,
  };
}

async function describeOpened(
  base: ReceivedItem,
  dek: Uint8Array,
  ciphertext: string,
  secretView: TextView,
  noteView: TextView,
): Promise<ReceivedItem> {
  if (base.itemType === 'file') {
    const manifest = await openManifest(ciphertext, dek);

    return {
      ...base,
      name: manifest.name,
      readable: true,
      sizeBytes: manifest.size,
      kind: fileKind(manifest.mime),
      mime: manifest.mime,
    };
  }

  if (base.itemType === 'document') {
    return { ...base, name: 'Shared document', readable: true };
  }

  const plaintext = await openText(ciphertext, dek);
  const view = base.itemType === 'secret' ? secretView(plaintext) : noteView(plaintext);

  return { ...base, name: view.name, readable: true, text: view.body };
}

function failure(base: ReceivedItem, step: string, error: unknown): ReceivedItem {
  const reason = error instanceof Error ? error.message : String(error);

  return { ...base, problem: `${step}: ${reason || 'the payload did not open'}` };
}

export async function describeReceived(
  context: AuthedContext,
  share: InboundShareRecord,
  connection: ConnectionRecord | undefined,
  secretView: TextView,
  noteView: TextView,
): Promise<ReceivedItem> {
  const base = unreadableBase(share, share.connection_id, 'inbound', share.sender_username);

  if (!connection) {
    return { ...base, problem: 'the connection it came through is gone' };
  }

  if (!share.wrapped_dek) {
    return { ...base, problem: 'it arrived without a wrapped key' };
  }

  let dek: Uint8Array | undefined;
  let step = 'unwrapping the item key';

  try {
    dek = await sharedItemDek(context, connection, share);

    step = 'fetching the item';
    const shared = await getSharedItem(context, share.id);

    step = 'opening the payload';
    return await describeOpened(base, dek, shared.ciphertext, secretView, noteView);
  } catch (error) {
    return failure(base, step, error);
  } finally {
    dek?.fill(0);
  }
}

async function ownCiphertext(context: AuthedContext, itemType: ItemType, itemId: string): Promise<string> {
  switch (itemType) {
    case 'secret':
      return (await getSecret(context, itemId)).ciphertext;
    case 'note':
      return (await getNote(context, itemId)).ciphertext;
    case 'file':
      return (await getFileDownload(context, itemId)).ciphertext;
    case 'document':
      return '';
  }
}

export async function describeSent(
  context: AuthedContext,
  share: ConnectionShareRecord,
  connection: ConnectionRecord,
  secretView: TextView,
  noteView: TextView,
): Promise<ReceivedItem> {
  const base = unreadableBase(share, connection.id, 'outbound', connection.username);

  let dek: Uint8Array | undefined;
  let step = 'unwrapping the item key';

  try {
    dek = await sharedItemDek(context, connection, share);

    step = 'fetching your item';
    const ciphertext = await ownCiphertext(context, share.item_type, share.item_id);

    step = 'opening the payload';
    return await describeOpened(base, dek, ciphertext, secretView, noteView);
  } catch (error) {
    return failure(base, step, error);
  } finally {
    dek?.fill(0);
  }
}
