import { assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { signActionEnvelope } from '@/lib/signing';
import { requireToken } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { pqxdhWrap } from '@/lib/pqxdh';
import {
  getSecret,
  vaultKekDekWrapper,
  type DekWrapper,
  type SecretRecord,
  type SecretsContext,
} from '@/lib/secrets';
import type { NoteRecord } from '@/lib/notes';
import type { DocumentRecord } from '@/lib/documents';
import type { Beneficiary, BeneficiaryRecipient } from './beneficiaries';
import { assertAssignable } from './beneficiaries';
import { UnsupportedItemTypeError } from './errors';

export const SHARE_VERSION = 'v1';

// Sorted the way the vault Merkle tree sorts them, so this list and
// lib/vaultmerkle's INHERITABLE_ITEM_TYPES read as the one set they are.
export const ITEM_TYPES = ['document', 'note', 'secret'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// InheritableItem is the only shape the assignment path knows. All three record
// types carry a wrapped_dek sealed under the same vault KEK, so unwrapping and
// re-wrapping is one function with item_type as data rather than three.
export interface InheritableItem {
  type: ItemType;
  id: string;
  wrappedDek: string;
}

export function inheritableSecret(secret: SecretRecord): InheritableItem {
  return { type: 'secret', id: secret.id, wrappedDek: secret.wrapped_dek };
}

export function inheritableNote(note: NoteRecord): InheritableItem {
  return { type: 'note', id: note.id, wrappedDek: note.wrapped_dek };
}

// A document's DEK seals its snapshot and every delta alike, so this one wrapped
// key is the whole assignment however long the log grows.
export function inheritableDocument(document: DocumentRecord): InheritableItem {
  return { type: 'document', id: document.id, wrappedDek: document.wrapped_dek };
}

export function isItemType(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

export function assertItemType(value: string): ItemType {
  if (!isItemType(value)) {
    throw new UnsupportedItemTypeError(value);
  }

  return value;
}

export interface InheritanceShare {
  id: string;
  beneficiary_id: string;
  item_id: string;
  item_type: ItemType;
  pq_hybrid_encrypted_item_key: string;
  version: string;
  created_at: string;
}

export type SuccessionContext = SecretsContext;

function wrapper(context: SuccessionContext): DekWrapper {
  return context.dek ?? vaultKekDekWrapper(context.session.vaultKek);
}

export async function wrapItemKeyForHeir(
  context: SuccessionContext,
  item: InheritableItem,
  recipient: BeneficiaryRecipient,
): Promise<string> {
  assertItemType(item.type);

  const dek = await wrapper(context).unwrapDek(item.wrappedDek);

  try {
    return await pqxdhWrap(
      dek,
      {
        x25519PublicKey: recipient.x25519PublicKey,
        mlkemPublicKey: recipient.mlkemPublicKey,
      },
      {
        usage: 'succession-dek',
        senderUserAddress: context.session.userAddress,
        recipientUserAddress: recipient.userAddress,
      },
    );
  } finally {
    zeroBytes(dek);
  }
}

export interface AssignShareResult {
  share: InheritanceShare;
  created: boolean;
}

export async function assignShare(
  context: SuccessionContext,
  beneficiary: Beneficiary,
  recipient: BeneficiaryRecipient,
  item: InheritableItem,
): Promise<AssignShareResult> {
  assertAssignable(beneficiary);

  const itemType = assertItemType(item.type);
  const beneficiaryId = assertCanonicalUuid(beneficiary.id, 'beneficiary_id');
  const itemId = assertCanonicalUuid(item.id, 'item_id');

  const wrappedItemKey = await wrapItemKeyForHeir(context, item, recipient);

  const envelope = signActionEnvelope(
    'share-assign',
    [beneficiaryId, itemId],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<InheritanceShare>({
    method: 'POST',
    path: '/succession/shares',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      beneficiary_id: beneficiaryId,
      item_id: itemId,
      item_type: itemType,
      pq_hybrid_encrypted_item_key: wrappedItemKey,
      version: SHARE_VERSION,
      ...envelope,
    },
  });

  return { share: response.data, created: response.status === 201 };
}

export async function assignSecretById(
  context: SuccessionContext,
  beneficiary: Beneficiary,
  recipient: BeneficiaryRecipient,
  secretId: string,
): Promise<AssignShareResult> {
  return assignShare(
    context,
    beneficiary,
    recipient,
    inheritableSecret(await getSecret(context, secretId)),
  );
}

export async function listShares(
  context: SuccessionContext,
  beneficiaryId: string,
): Promise<InheritanceShare[]> {
  const canonical = assertCanonicalUuid(beneficiaryId, 'beneficiary_id');

  return collectPages<InheritanceShare>((page: PageRequest) =>
    request<InheritanceShare[]>({
      method: 'GET',
      path: `/succession/beneficiaries/${canonical}/shares`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

/**
 * Every share this owner has assigned, across all heirs, in one call.
 *
 * The anchor pass needs the union of assigned item ids, and building it from the
 * per-heir listing costs a paginated walk per heir on a path that runs on every
 * Succession screen load.
 */
export async function listAllShares(context: SuccessionContext): Promise<InheritanceShare[]> {
  return collectPages<InheritanceShare>((page: PageRequest) =>
    request<InheritanceShare[]>({
      method: 'GET',
      path: '/succession/shares',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

/** The item ids anyone inherits — what the vault tree is built over. */
export function assignedItemIds(shares: readonly InheritanceShare[]): Set<string> {
  return new Set(shares.map((share) => share.item_id));
}

export async function deleteShare(
  context: SuccessionContext,
  shareId: string,
): Promise<void> {
  const canonical = assertCanonicalUuid(shareId, 'share_id');

  const envelope = signActionEnvelope(
    'share-delete',
    [canonical],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  await request<void>({
    method: 'DELETE',
    path: `/succession/shares/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export interface ItemAssignment {
  beneficiary: Beneficiary;
  share: InheritanceShare;
}

export async function findItemAssignments(
  context: SuccessionContext,
  beneficiaries: readonly Beneficiary[],
  itemId: string,
): Promise<ItemAssignment[]> {
  const canonical = assertCanonicalUuid(itemId, 'item_id');
  const assignments: ItemAssignment[] = [];

  for (const beneficiary of beneficiaries) {
    for (const share of await listShares(context, beneficiary.id)) {
      if (share.item_id === canonical) {
        assignments.push({ beneficiary, share });
      }
    }
  }

  return assignments;
}
