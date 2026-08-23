import {
  verifyReport,
  type Beneficiary,
  type ChainStatus,
  type ReleaseStatusRecord,
  type ReleaseVoteReport,
  type VerifiedReleaseVote,
} from '@/lib/succession';

export const LAST_CHECK_IN_CAVEAT =
  'The heartbeat is an on-chain action this API only mirrors. It appears once the smart account ' +
  'has been configured on-chain.';

export const CHAIN_UNAVAILABLE_CAVEAT =
  'The chain status could not be read. This says nothing about the switch itself — retry.';

export const CONFIGURATION_CAVEAT =
  'The inactivity threshold and the guardian quorum are configured on-chain, not here.';

export interface ReleaseView {
  status: ReleaseStatusRecord['status'];
  headline: string;
  votes: number;
  requiredVotes: number;
  releaseCycle: number;
  countdownStartedAt?: Date;
  inactivityThresholdDays: number;
  chainStatus: ChainStatus;
  chainUnavailable: boolean;
  smartAccountAddress: string;
  lastCheckIn?: Date;
  triggerableAt?: Date;
}

function fromUnixSeconds(seconds: number | undefined): Date | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000);
}

export function buildReleaseView(record: ReleaseStatusRecord): ReleaseView {
  const countingDown = record.status === 'counting_down';
  const lastCheckIn = fromUnixSeconds(record.chain.last_check_in);
  const triggerableAt = fromUnixSeconds(record.chain.triggerable_at);

  return {
    status: record.status,
    headline: countingDown
      ? 'Your guardians have voted to release. The countdown is running.'
      : 'No release has been requested. Your vault is monitoring normally.',
    votes: record.votes,
    requiredVotes: record.required_votes,
    releaseCycle: record.release_cycle,
    ...(record.trigger_started_at === undefined
      ? {}
      : { countdownStartedAt: new Date(record.trigger_started_at) }),
    inactivityThresholdDays: record.inactivity_threshold_days,
    chainStatus: record.chain.status,
    chainUnavailable: record.chain.status === 'unknown',
    smartAccountAddress: record.chain.smart_account_address,
    ...(lastCheckIn === undefined ? {} : { lastCheckIn }),
    ...(triggerableAt === undefined ? {} : { triggerableAt }),
  };
}

export interface AuditedVotes {
  ownerUserAddress: string;
  releaseCycle: number;
  votes: VerifiedReleaseVote[];
  verifiedCount: number;
  unverifiedCount: number;
}

export function auditVotes(report: ReleaseVoteReport): AuditedVotes {
  const votes = verifyReport(report);

  return {
    ownerUserAddress: report.owner_user_address,
    releaseCycle: report.release_cycle,
    votes,
    verifiedCount: votes.filter((entry) => entry.valid).length,
    unverifiedCount: votes.filter((entry) => !entry.valid).length,
  };
}

export interface BeneficiaryView {
  id: string;
  username: string;
  shareCount: number;
  accountClosed: boolean;
  status: string;
  createdAt: string;
}

export function buildBeneficiaryViews(
  beneficiaries: readonly Beneficiary[],
): BeneficiaryView[] {
  return beneficiaries.map((beneficiary) => ({
    id: beneficiary.id,
    username: beneficiary.keys_rotated ? '(account closed)' : beneficiary.username,
    shareCount: beneficiary.share_count,
    accountClosed: beneficiary.keys_rotated,
    status: beneficiary.status,
    createdAt: beneficiary.created_at,
  }));
}
