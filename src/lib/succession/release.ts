import { request } from '@/lib/api';
import { buildActionPayload, signActionEnvelope, verifyPayload } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';
import { spkiBase64ToUncompressedPoint } from '@/lib/encoding';
import { listGuardianships, type Guardianship } from '@/lib/recovery';
import { SuccessionValidationError } from './errors';

export const REACHABLE_RELEASE_STATUSES = ['monitoring', 'counting_down'] as const;
export type ReleaseStatus = (typeof REACHABLE_RELEASE_STATUSES)[number];

export interface ReleaseStatusRecord {
  status: ReleaseStatus;
  votes: number;
  required_votes: number;
  release_cycle: number;
  inactivity_threshold_days: number;
  last_check_in: string;
  trigger_started_at?: string;
}

export interface ReleaseVote {
  guardian_username: string;
  guardian_public_key: string;
  release_cycle: number;
  signature: string;
  challenge: string;
  timestamp: number;
  voted_at: string;
}

export interface ReleaseVoteReport {
  action: string;
  owner_user_address: string;
  release_cycle: number;
  votes: ReleaseVote[];
}

export class GuardianshipNotVotableError extends SuccessionValidationError {
  readonly ownerUsername: string;

  constructor(ownerUsername: string, reason: string) {
    super(
      `cannot cast a release vote for "${ownerUsername}": ${reason}`,
      'GuardianshipNotVotableError',
    );
    this.ownerUsername = ownerUsername;
  }
}

export interface VotableOwner {
  ownerUsername: string;
  ownerUserAddress: string;
  releaseCycle: number;
}

export async function getReleaseStatus(
  context: AuthedContext,
): Promise<ReleaseStatusRecord> {
  const response = await request<ReleaseStatusRecord>({
    method: 'GET',
    path: '/succession/status',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export function isCountingDown(status: ReleaseStatusRecord): boolean {
  return status.status === 'counting_down';
}

export function countdownStartedAt(status: ReleaseStatusRecord): Date | undefined {
  return status.trigger_started_at === undefined
    ? undefined
    : new Date(status.trigger_started_at);
}

export function toVotableOwner(guardianship: Guardianship): VotableOwner {
  if (guardianship.status !== 'active') {
    throw new GuardianshipNotVotableError(
      guardianship.owner_username,
      `the guardianship is "${guardianship.status}", not active`,
    );
  }
  if (guardianship.owner_user_address === undefined) {
    throw new GuardianshipNotVotableError(
      guardianship.owner_username,
      'the guardianship row carries no owner_user_address',
    );
  }
  if (guardianship.owner_release_cycle === undefined) {
    throw new GuardianshipNotVotableError(
      guardianship.owner_username,
      'the guardianship row carries no owner_release_cycle',
    );
  }

  return {
    ownerUsername: guardianship.owner_username,
    ownerUserAddress: guardianship.owner_user_address,
    releaseCycle: guardianship.owner_release_cycle,
  };
}

export async function readVotableOwner(
  context: AuthedContext,
  ownerUsername: string,
): Promise<VotableOwner> {
  const guardianships = await listGuardianships(context);
  const row = guardianships.find(
    (guardianship) => guardianship.owner_username === ownerUsername,
  );

  if (row === undefined) {
    throw new GuardianshipNotVotableError(ownerUsername, 'you do not guard that account');
  }

  return toVotableOwner(row);
}

export async function castReleaseVote(
  context: AuthedContext,
  ownerUsername: string,
): Promise<ReleaseStatusRecord> {
  const owner = await readVotableOwner(context, ownerUsername);

  const envelope = signActionEnvelope(
    'succession-release-vote',
    [owner.ownerUserAddress, owner.releaseCycle],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<ReleaseStatusRecord>({
    method: 'POST',
    path: '/succession/votes',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { owner_username: owner.ownerUsername, ...envelope },
  });

  return response.data;
}

export async function listReleaseVotes(
  context: AuthedContext,
  options: { limit?: number; maxPages?: number } = {},
): Promise<ReleaseVoteReport> {
  const { limit, maxPages = 1000 } = options;

  let report: ReleaseVoteReport | undefined;
  const votes: ReleaseVote[] = [];
  let cursor: string | undefined;

  for (let pages = 0; pages < maxPages; pages++) {
    const response = await request<ReleaseVoteReport>({
      method: 'GET',
      path: '/succession/votes',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit, cursor },
    });

    report = response.data;
    votes.push(...(response.data.votes ?? []));

    if (response.page === undefined || response.page.has_more !== true) {
      break;
    }
    if (response.page.next_cursor === undefined) {
      break;
    }
    cursor = response.page.next_cursor;
  }

  if (report === undefined) {
    throw new Error('no release-vote page was returned');
  }

  return { ...report, votes };
}

export interface VerifiedReleaseVote {
  vote: ReleaseVote;
  valid: boolean;
}

export function verifyReleaseVotes(
  ownerUserAddress: string,
  releaseCycle: number,
  votes: readonly ReleaseVote[],
): VerifiedReleaseVote[] {
  return votes.map((vote) => {
    let valid = false;
    try {
      const payload = buildActionPayload(
        vote.challenge,
        vote.timestamp,
        'succession-release-vote',
        [ownerUserAddress, vote.release_cycle ?? releaseCycle],
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

export function verifyReport(report: ReleaseVoteReport): VerifiedReleaseVote[] {
  return verifyReleaseVotes(report.owner_user_address, report.release_cycle, report.votes);
}
