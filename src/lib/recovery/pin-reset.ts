import { assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { deriveServerAuthToken } from '@/lib/pin';
import { buildActionPayload, signActionEnvelope, verifyPayload } from '@/lib/signing';
import { spkiBase64ToUncompressedPoint } from '@/lib/encoding';
import { requireToken, type AuthedContext } from '@/lib/context';
import type { SessionKeystore } from '@/lib/session';

export const PIN_RESET_POLL_INTERVAL_MS = 60_000;
export const CONTEST_PERIOD_HOURS = 48;

export const PIN_RESET_STATUSES = [
  'pending_quorum',
  'contest_period',
  'authorized',
  'revoked',
  'completed',
] as const;
export type PinResetStatus = (typeof PIN_RESET_STATUSES)[number];

export interface PinResetRequest {
  id: string;
  status: PinResetStatus;
  votes: number;
  required_votes: number;
  contest_period_ends_at?: string;
  created_at: string;
}

export interface PendingPinReset {
  request_id: string;
  owner_username: string;
  status: PinResetStatus;
  voted: boolean;
  created_at: string;
}

export interface PinResetVote {
  guardian_username: string;
  guardian_public_key: string;
  signature: string;
  challenge: string;
  timestamp: number;
  voted_at: string;
}

export interface OpenedPinReset {
  request: PinResetRequest;
  created: boolean;
}

/**
 * Owner actions carry no `password` — the whole flow exists because the owner
 * lost their PIN. That is structural, not an oversight.
 */
function ownerEnvelope(
  session: SessionKeystore,
  action: 'pin-reset-request' | 'pin-reset-revoke' | 'pin-reset-confirm',
  args: readonly string[],
) {
  return signActionEnvelope(action, args, { privateKey: session.identityPrivateKey }, {
    paranoid: false,
  });
}

export async function requestPinReset(
  session: SessionKeystore,
  options: { timeoutMs?: number } = {},
): Promise<OpenedPinReset> {
  const userAddress = session.userAddress;
  const envelope = ownerEnvelope(session, 'pin-reset-request', [userAddress]);

  const response = await request<PinResetRequest>({
    method: 'POST',
    path: '/auth/pin-reset/request',
    timeoutMs: options.timeoutMs,
    body: { user_address: userAddress, ...envelope },
  });

  return { request: response.data, created: response.status === 201 };
}

export async function getPinResetStatus(
  requestId: string,
  options: { timeoutMs?: number } = {},
): Promise<PinResetRequest> {
  const response = await request<PinResetRequest>({
    method: 'GET',
    path: `/auth/pin-reset/${assertCanonicalUuid(requestId, 'request_id')}`,
    timeoutMs: options.timeoutMs,
  });
  return response.data;
}

export async function revokePinReset(
  session: SessionKeystore,
  requestId: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const canonical = assertCanonicalUuid(requestId, 'request_id');
  const envelope = ownerEnvelope(session, 'pin-reset-revoke', [canonical]);

  await request<void>({
    method: 'PATCH',
    path: '/auth/pin-reset/revoke',
    timeoutMs: options.timeoutMs,
    body: { request_id: canonical, ...envelope },
  });
}

export async function confirmPinReset(
  session: SessionKeystore,
  requestId: string,
  newPin: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const canonical = assertCanonicalUuid(requestId, 'request_id');
  const newToken = await deriveServerAuthToken(newPin, session.userAddress);
  const envelope = ownerEnvelope(session, 'pin-reset-confirm', [canonical, newToken]);

  await request<void>({
    method: 'PATCH',
    path: '/auth/pin-reset/confirm',
    timeoutMs: options.timeoutMs,
    body: { request_id: canonical, new_password: newToken, ...envelope },
  });

  await session.rekeySecondFactor(newPin);
}

export async function listPendingPinResets(
  context: AuthedContext,
): Promise<PendingPinReset[]> {
  return collectPages<PendingPinReset>((page: PageRequest) =>
    request<PendingPinReset[]>({
      method: 'GET',
      path: '/recovery/pin-reset/pending',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

export function canVoteOn(row: PendingPinReset): boolean {
  return row.status === 'pending_quorum' && !row.voted;
}

export async function voteOnPinReset(
  context: AuthedContext,
  requestId: string,
  guardianUsername: string,
): Promise<PinResetRequest> {
  const canonical = assertCanonicalUuid(requestId, 'request_id');

  const envelope = signActionEnvelope(
    'pin-reset-vote',
    [canonical],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<PinResetRequest>({
    method: 'POST',
    path: '/auth/pin-reset/vote',
    timeoutMs: context.timeoutMs,
    body: { request_id: canonical, guardian_username: guardianUsername, ...envelope },
  });

  return response.data;
}

export interface VoteReport {
  action: string;
  request_id: string;
  votes: PinResetVote[];
}

export async function listPinResetVotes(
  context: AuthedContext,
  requestId: string,
): Promise<VoteReport> {
  const canonical = assertCanonicalUuid(requestId, 'request_id');

  const response = await request<VoteReport>({
    method: 'GET',
    path: `/auth/pin-reset/${canonical}/votes`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}

export interface VerifiedVote {
  vote: PinResetVote;
  valid: boolean;
}

/**
 * Rebuilds the payload from the semantic fields rather than trusting any
 * server-rendered string — a verifier that trusts the server's rendering of
 * what was signed has verified nothing.
 */
export function verifyPinResetVotes(
  requestId: string,
  votes: readonly PinResetVote[],
): VerifiedVote[] {
  return votes.map((vote) => {
    let valid = false;
    try {
      const payload = buildActionPayload(
        vote.challenge,
        vote.timestamp,
        'pin-reset-vote',
        [requestId],
      );
      valid = verifyPayload(
        payload,
        vote.signature,
        spkiBase64ToUncompressedPoint(vote.guardian_public_key),
      );
    } catch {
      valid = false;
    }
    return { vote, valid };
  });
}

export function contestPeriodEndsAt(request: PinResetRequest): Date | undefined {
  return request.contest_period_ends_at === undefined
    ? undefined
    : new Date(request.contest_period_ends_at);
}

export function contestPeriodRemainingMs(
  request: PinResetRequest,
  now: Date = new Date(),
): number | undefined {
  const ends = contestPeriodEndsAt(request);
  return ends === undefined ? undefined : Math.max(0, ends.getTime() - now.getTime());
}
