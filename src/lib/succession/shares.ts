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
import type { Beneficiary, BeneficiaryRecipient } from './beneficiaries';
import { assertAssignable } from './beneficiaries';

export const SHARE_VERSION = 'v1';
export const ITEM_TYPES = ['secret'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

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
  secret: SecretRecord,
  recipient: BeneficiaryRecipient,
): Promise<string> {
  const dek = await wrapper(context).unwrapDek(secret.wrapped_dek);

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
  secret: SecretRecord,
): Promise<AssignShareResult> {
  assertAssignable(beneficiary);

  const beneficiaryId = assertCanonicalUuid(beneficiary.id, 'beneficiary_id');
  const itemId = assertCanonicalUuid(secret.id, 'item_id');

  const wrappedItemKey = await wrapItemKeyForHeir(context, secret, recipient);

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
      item_type: 'secret',
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
  const secret = await getSecret(context, secretId);
  return assignShare(context, beneficiary, recipient, secret);
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
