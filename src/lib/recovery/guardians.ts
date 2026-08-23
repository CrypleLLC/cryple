import { assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { signActionEnvelope } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';
import { base64ToBytes } from '@/lib/encoding';
import { effectiveQuorum } from './shamir';
import type { GuardianRecipient } from './setup';

export const GUARDIAN_STATUSES = ['pending_invite', 'active', 'revoked'] as const;
export type GuardianStatus = (typeof GUARDIAN_STATUSES)[number];

export interface Guardian {
  id: string;
  username: string;
  user_address?: string;
  status: GuardianStatus;
  encryption_public_key_x25519?: string;
  encryption_public_key_mlkem?: string;
  has_share: boolean;
  created_at: string;
}

export interface Guardianship {
  id: string;
  owner_username: string;
  owner_user_address?: string;
  owner_release_cycle?: number;
  status: GuardianStatus;
  created_at: string;
}

export interface RevokeResult {
  id: string;
  username: string;
  status: GuardianStatus;
  share_removed: boolean;
  votes_withdrawn: number;
  active_guardians: number;
  recovery_setup_stale: boolean;
}

export async function inviteGuardian(
  context: AuthedContext,
  guardianUsername: string,
): Promise<Guardian> {
  const envelope = signActionEnvelope(
    'guardian-invite',
    [guardianUsername],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<Guardian>({
    method: 'POST',
    path: '/recovery/guardians/invite',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { guardian_username: guardianUsername, ...envelope },
  });

  return response.data;
}

export async function acceptGuardianship(
  context: AuthedContext,
  invitationId: string,
): Promise<void> {
  const canonical = assertCanonicalUuid(invitationId, 'invitation_id');

  const envelope = signActionEnvelope(
    'guardian-accept',
    [canonical],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  await request<void>({
    method: 'PATCH',
    path: `/recovery/guardians/${canonical}/accept`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export async function revokeGuardian(
  context: AuthedContext,
  guardianId: string,
): Promise<RevokeResult> {
  const canonical = assertCanonicalUuid(guardianId, 'guardian_id');

  const envelope = signActionEnvelope(
    'guardian-revoke',
    [canonical],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<RevokeResult>({
    method: 'DELETE',
    path: `/recovery/guardians/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });

  return response.data;
}

export async function listGuardians(context: AuthedContext): Promise<Guardian[]> {
  return collectPages<Guardian>((page: PageRequest) =>
    request<Guardian[]>({
      method: 'GET',
      path: '/recovery/guardians',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

export async function listGuardianships(context: AuthedContext): Promise<Guardianship[]> {
  return collectPages<Guardianship>((page: PageRequest) =>
    request<Guardianship[]>({
      method: 'GET',
      path: '/recovery/guardianships',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

export function activeGuardians(guardians: readonly Guardian[]): Guardian[] {
  return guardians.filter((guardian) => guardian.status === 'active');
}

export function pendingInvitations(guardianships: readonly Guardianship[]): Guardianship[] {
  return guardianships.filter((row) => row.status === 'pending_invite');
}

export interface QuorumSummary {
  activeGuardians: number;
  configuredThreshold: number;
  effectiveQuorum: number;
  raisesBarWithoutParticipant: boolean;
}

export function summarizeQuorum(
  guardians: readonly Guardian[],
  configuredThreshold: number,
): QuorumSummary {
  const active = activeGuardians(guardians).length;
  return {
    activeGuardians: active,
    configuredThreshold,
    effectiveQuorum: effectiveQuorum(configuredThreshold, active),
    raisesBarWithoutParticipant: configuredThreshold > active,
  };
}

export class GuardianKeysUnavailableError extends Error {
  readonly username: string;

  constructor(username: string) {
    super(
      `guardian "${username}" has no enrolled encryption keys — they are not active yet, ` +
        'so a share cannot be wrapped for them',
    );
    this.name = 'GuardianKeysUnavailableError';
    this.username = username;
  }
}

export class GuardianAddressUnavailableError extends Error {
  readonly username: string;

  constructor(username: string) {
    super(
      `guardian "${username}" has not accepted their invitation yet, so their account ` +
        'address is withheld and a share cannot be wrapped for them',
    );
    this.name = 'GuardianAddressUnavailableError';
    this.username = username;
  }
}

export function recipientFor(guardian: Guardian): GuardianRecipient {
  if (guardian.user_address === undefined || guardian.user_address.length === 0) {
    throw new GuardianAddressUnavailableError(guardian.username);
  }

  return toRecipient(guardian, guardian.user_address);
}

export function toRecipient(guardian: Guardian, userAddress: string): GuardianRecipient {
  if (
    guardian.encryption_public_key_x25519 === undefined ||
    guardian.encryption_public_key_mlkem === undefined
  ) {
    throw new GuardianKeysUnavailableError(guardian.username);
  }

  return {
    username: guardian.username,
    userAddress,
    x25519PublicKey: base64ToBytes(guardian.encryption_public_key_x25519),
    mlkemPublicKey: base64ToBytes(guardian.encryption_public_key_mlkem),
  };
}
