import { assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { signActionEnvelope } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';
import { base64ToBytes } from '@/lib/encoding';
import { lookupUsername } from '@/lib/users';
import {
  BeneficiaryAccountClosedError,
  BeneficiaryAddressMismatchError,
  SuccessionValidationError,
} from './errors';

export const BENEFICIARY_STATUSES = ['active', 'pending_invite'] as const;
export type BeneficiaryStatus = (typeof BENEFICIARY_STATUSES)[number];

export interface Beneficiary {
  id: string;
  user_uuid: string;
  username: string;
  encrypted_label: string;
  public_key_x25519_snapshot: string;
  public_key_mlkem_snapshot: string;
  status: BeneficiaryStatus;
  keys_rotated: boolean;
  share_count: number;
  dropped_shares?: number;
  created_at: string;
}

export interface RegisteredBeneficiary {
  beneficiary: Beneficiary;
  created: boolean;
  droppedShares: number;
}

export interface BeneficiaryRecipient {
  username: string;
  userAddress: string;
  x25519PublicKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
}

export async function registerBeneficiary(
  context: AuthedContext,
  beneficiaryUsername: string,
  encryptedLabel: string,
): Promise<RegisteredBeneficiary> {
  if (encryptedLabel.length === 0) {
    throw new SuccessionValidationError('encrypted_label must not be empty');
  }
  if (beneficiaryUsername.length === 0) {
    throw new SuccessionValidationError('beneficiary_username must not be empty');
  }

  const envelope = signActionEnvelope(
    'beneficiary-register',
    [beneficiaryUsername],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<Beneficiary>({
    method: 'POST',
    path: '/succession/beneficiaries',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      beneficiary_username: beneficiaryUsername,
      encrypted_label: encryptedLabel,
      ...envelope,
    },
  });

  return {
    beneficiary: response.data,
    created: response.status === 201,
    droppedShares: response.data.dropped_shares ?? 0,
  };
}

export async function listBeneficiaries(context: AuthedContext): Promise<Beneficiary[]> {
  return collectPages<Beneficiary>((page: PageRequest) =>
    request<Beneficiary[]>({
      method: 'GET',
      path: '/succession/beneficiaries',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

export async function deleteBeneficiary(
  context: AuthedContext,
  beneficiaryId: string,
): Promise<void> {
  const canonical = assertCanonicalUuid(beneficiaryId, 'beneficiary_id');

  const envelope = signActionEnvelope(
    'beneficiary-delete',
    [canonical],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  await request<void>({
    method: 'DELETE',
    path: `/succession/beneficiaries/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export function isAccountClosed(beneficiary: Beneficiary): boolean {
  return beneficiary.keys_rotated;
}

export function closedAccountBeneficiaries(
  beneficiaries: readonly Beneficiary[],
): Beneficiary[] {
  return beneficiaries.filter(isAccountClosed);
}

export const CLOSED_ACCOUNT_REMEDY =
  'This heir closed their account. Remove them and choose another.';

export function assertAssignable(beneficiary: Beneficiary): void {
  if (isAccountClosed(beneficiary)) {
    throw new BeneficiaryAccountClosedError(beneficiary.id);
  }
}

export function toRecipient(
  beneficiary: Beneficiary,
  userAddress: string,
): BeneficiaryRecipient {
  assertAssignable(beneficiary);

  return {
    username: beneficiary.username,
    userAddress,
    x25519PublicKey: base64ToBytes(beneficiary.public_key_x25519_snapshot),
    mlkemPublicKey: base64ToBytes(beneficiary.public_key_mlkem_snapshot),
  };
}

export async function resolveRecipient(
  beneficiary: Beneficiary,
  userAddress: string,
  options: { timeoutMs?: number } = {},
): Promise<BeneficiaryRecipient> {
  assertAssignable(beneficiary);

  const resolved = await lookupUsername(userAddress, options);
  if (resolved !== beneficiary.username) {
    throw new BeneficiaryAddressMismatchError(beneficiary.username, userAddress, resolved);
  }

  return toRecipient(beneficiary, userAddress);
}
