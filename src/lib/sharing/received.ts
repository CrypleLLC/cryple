import { fileKind, type FileKind } from '@/lib/app/files';
import { openManifest } from '@/lib/files';
import { openText } from '@/lib/sealed';
import type { AuthedContext } from '@/lib/context';
import { getSharedItem, type ConnectionRecord, type InboundShareRecord } from './api';
import { sharedItemDek } from './flows';

export interface ReceivedItem {
  shareId: string;
  connectionId: string;
  itemType: InboundShareRecord['item_type'];
  from: string;
  createdAt: string;
  name: string;
  readable: boolean;
  problem?: string;
  sizeBytes?: number;
  kind?: FileKind;
  text?: string;
}

export interface SharedTextView {
  name: string;
  body: string;
}

export const UNREADABLE_SHARED_NAME = 'Unreadable';

export async function describeReceived(
  context: AuthedContext,
  share: InboundShareRecord,
  connection: ConnectionRecord | undefined,
  secretView: (plaintext: string) => SharedTextView,
  noteView: (plaintext: string) => SharedTextView,
): Promise<ReceivedItem> {
  const base: ReceivedItem = {
    shareId: share.id,
    connectionId: share.connection_id,
    itemType: share.item_type,
    from: share.sender_username,
    createdAt: share.created_at,
    name: UNREADABLE_SHARED_NAME,
    readable: false,
  };

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

    if (share.item_type === 'file') {
      const manifest = await openManifest(shared.ciphertext, dek);

      return {
        ...base,
        name: manifest.name,
        readable: true,
        sizeBytes: manifest.size,
        kind: fileKind(manifest.mime),
      };
    }

    if (share.item_type === 'document') {
      return { ...base, name: 'Shared document', readable: true };
    }

    const plaintext = await openText(shared.ciphertext, dek);
    const view = share.item_type === 'secret' ? secretView(plaintext) : noteView(plaintext);

    return { ...base, name: view.name, readable: true, text: view.body };
  } catch (error) {

    const reason = error instanceof Error ? error.message : String(error);

    return { ...base, problem: `${step}: ${reason || 'the payload did not open'}` };
  } finally {
    dek?.fill(0);
  }
}
