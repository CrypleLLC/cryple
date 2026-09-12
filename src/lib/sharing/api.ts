import { assertCanonicalUuid, request } from '@/lib/api';
import { signActionEnvelope } from '@/lib/signing';
import { normalizeUsername, isUsername, MalformedUsernameError } from '@/lib/users';
import { requireToken, type AuthedContext } from '@/lib/context';

export const ITEM_TYPES = ['secret', 'note', 'document', 'file'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type ConnectionStatus = 'pending' | 'accepted';
export type ConnectionDirection = 'inbound' | 'outbound';

export interface ConnectionRecord {
  id: string;
  direction: ConnectionDirection;
  username: string;
  user_address: string;
  status: ConnectionStatus;
  pqxdh_blob?: string;
  sender_wrapped_key?: string;
  created_at: string;
}

export interface ShareRecord {
  id: string;
  connection_id: string;
  item_type: ItemType;
  item_id: string;
  wrapped_dek?: string;
  created_at: string;
}

export interface InboundShareRecord extends ShareRecord {
  sender_username: string;
}

export interface ItemRecipientRecord {
  id: string;
  item_type: ItemType;
  item_id: string;
  username: string;
  created_at: string;
}

export interface SharedItemRecord extends InboundShareRecord {
  ciphertext: string;
}

export interface SharedDownloadRecord {
  share_id: string;
  wrapped_dek: string;
  url: string;
  expires_at: string;
}

export interface CreateConnectionRequest {
  recipientUsername: string;
  pqxdhBlob: string;
  senderWrappedKey: string;
  id?: string;
}

function sign(
  context: AuthedContext,
  action: Parameters<typeof signActionEnvelope>[0],
  args: readonly string[],
) {
  return signActionEnvelope(
    action,
    args,
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );
}

export async function createConnection(
  context: AuthedContext,
  input: CreateConnectionRequest,
): Promise<ConnectionRecord> {
  const username = normalizeUsername(input.recipientUsername);
  if (!isUsername(username)) {
    throw new MalformedUsernameError(input.recipientUsername);
  }

  const id = input.id === undefined ? crypto.randomUUID() : assertCanonicalUuid(input.id);

  const response = await request<ConnectionRecord>({
    method: 'POST',
    path: '/connections',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      id,
      recipient_username: username,
      pqxdh_blob: input.pqxdhBlob,
      sender_wrapped_key: input.senderWrappedKey,
      ...sign(context, 'connection-invite', [username, input.pqxdhBlob]),
    },
  });

  return response.data;
}

export async function listConnections(
  context: AuthedContext,
  page?: { limit?: number; offset?: number },
): Promise<ConnectionRecord[]> {
  const response = await request<ConnectionRecord[]>({
    method: 'GET',
    path: '/connections',
    query: page,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data ?? [];
}

export async function acceptConnection(context: AuthedContext, id: string): Promise<void> {
  assertCanonicalUuid(id);

  await request<void>({
    method: 'POST',
    path: `/connections/${id}/accept`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: sign(context, 'connection-accept', [id]),
  });
}

export async function deleteConnection(context: AuthedContext, id: string): Promise<void> {
  assertCanonicalUuid(id);

  await request<void>({
    method: 'DELETE',
    path: `/connections/${id}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: sign(context, 'connection-delete', [id]),
  });
}

export async function createShare(
  context: AuthedContext,
  input: {
    connectionId: string;
    itemType: ItemType;
    itemId: string;
    wrappedDek: string;
    id?: string;
  },
): Promise<ShareRecord> {
  const id = input.id === undefined ? crypto.randomUUID() : assertCanonicalUuid(input.id);
  assertCanonicalUuid(input.connectionId);
  assertCanonicalUuid(input.itemId);

  const response = await request<ShareRecord>({
    method: 'POST',
    path: '/shares',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      id,
      connection_id: input.connectionId,
      item_type: input.itemType,
      item_id: input.itemId,
      wrapped_dek: input.wrappedDek,
      ...sign(context, 'share-create', [input.connectionId, input.itemType, input.itemId]),
    },
  });

  return response.data;
}

export async function deleteShare(context: AuthedContext, id: string): Promise<void> {
  assertCanonicalUuid(id);

  await request<void>({
    method: 'DELETE',
    path: `/shares/${id}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: sign(context, 'share-delete', [id]),
  });
}

export async function listInbox(
  context: AuthedContext,
  page?: { limit?: number; offset?: number },
): Promise<InboundShareRecord[]> {
  const response = await request<InboundShareRecord[]>({
    method: 'GET',
    path: '/shares',
    query: page,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data ?? [];
}

export async function getSharedItem(
  context: AuthedContext,
  shareId: string,
): Promise<SharedItemRecord> {
  assertCanonicalUuid(shareId);

  const response = await request<SharedItemRecord>({
    method: 'GET',
    path: `/shares/${shareId}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}

export async function getSharedDownload(
  context: AuthedContext,
  shareId: string,
): Promise<SharedDownloadRecord> {
  assertCanonicalUuid(shareId);

  const response = await request<SharedDownloadRecord>({
    method: 'GET',
    path: `/shares/${shareId}/download`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}

export async function listItemRecipients(
  context: AuthedContext,
  itemType: ItemType,
  itemId: string,
): Promise<ItemRecipientRecord[]> {
  assertCanonicalUuid(itemId);

  const response = await request<ItemRecipientRecord[]>({
    method: 'GET',
    path: `/items/${itemType}/${itemId}/shares`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data ?? [];
}
