import { collectPages, request, assertCanonicalUuid, type PageRequest } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import type { DocumentUpdateRecord } from '@/lib/documents';
import { SuccessionValidationError } from './errors';
import type { AnchorLeafSet, AnchorSummary } from './anchors';
import type { InheritanceShare, ItemType } from './shares';

const USER_ADDRESS = /^[0-9a-f]{64}$/;

export interface Inheritance {
  owner_user_address: string;
  owner_username: string;
  smart_account_address: string;
  beneficiary_id: string;
  item_count: number;
  released_at?: number;
}

export interface InheritedContent {
  item_id: string;
  item_type: ItemType;
  version: string;
  ciphertext?: string;
  snapshot_ciphertext?: string;
  snapshot_seq?: number;
}

function assertOwner(userAddress: string): string {
  if (!USER_ADDRESS.test(userAddress)) {
    throw new SuccessionValidationError('owner_user_address must be 64 lowercase hex characters');
  }

  return userAddress;
}

/**
 * The accounts that named the caller as an heir **and have released on-chain**.
 *
 * An empty array is the normal answer and carries no information: an account
 * whose owner is alive is omitted entirely, not reported as pending, so being
 * named is indistinguishable from not being named. Never build a "you may be an
 * heir" surface on top of this — the API cannot answer that question, and the
 * reason is that an heir who knows can watch the owner's public check-in cadence.
 */
export async function listInheritances(context: AuthedContext): Promise<Inheritance[]> {
  const response = await request<Inheritance[]>({
    method: 'GET',
    path: '/succession/inheritances',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}

export async function listInheritedItems(
  context: AuthedContext,
  ownerAddress: string,
): Promise<InheritanceShare[]> {
  const response = await request<InheritanceShare[]>({
    method: 'GET',
    path: `/succession/inheritances/${assertOwner(ownerAddress)}/items`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}

/**
 * One item's ciphertext, **byte-identical to what the owner stored**.
 *
 * The leaf commits to `hex(SHA-256(blob))` of exactly these bytes, so anything
 * that re-encodes them between here and the hash breaks a proof that is
 * otherwise correct.
 */
export async function getInheritedContent(
  context: AuthedContext,
  ownerAddress: string,
  itemId: string,
): Promise<InheritedContent> {
  const response = await request<InheritedContent>({
    method: 'GET',
    path: `/succession/inheritances/${assertOwner(ownerAddress)}/items/${assertCanonicalUuid(itemId, 'item_id')}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}

/**
 * A document's deltas past `since`.
 *
 * **Everything this returns is unverifiable by construction** — the anchored
 * leaf covers the snapshot alone, and these were appended after the compaction
 * that produced it. Fetch them, because a document without its deltas is stale,
 * but never render them under the same "verified" as the snapshot.
 */
export async function listInheritedUpdates(
  context: AuthedContext,
  ownerAddress: string,
  itemId: string,
  since: number,
): Promise<DocumentUpdateRecord[]> {
  const owner = assertOwner(ownerAddress);
  const id = assertCanonicalUuid(itemId, 'item_id');

  return collectPages<DocumentUpdateRecord>((page: PageRequest) =>
    request<DocumentUpdateRecord[]>({
      method: 'GET',
      path: `/succession/inheritances/${owner}/items/${id}/updates`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { since, limit: page.limit, cursor: page.cursor },
    }),
  );
}

export async function listInheritedAnchors(
  context: AuthedContext,
  ownerAddress: string,
): Promise<AnchorSummary[]> {
  const owner = assertOwner(ownerAddress);

  return collectPages<AnchorSummary>((page: PageRequest) =>
    request<AnchorSummary[]>({
      method: 'GET',
      path: `/succession/inheritances/${owner}/anchors`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

export async function getInheritedAnchor(
  context: AuthedContext,
  ownerAddress: string,
  epoch: number,
): Promise<AnchorLeafSet> {
  const response = await request<AnchorLeafSet>({
    method: 'GET',
    path: `/succession/inheritances/${assertOwner(ownerAddress)}/anchors/${epoch}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}
