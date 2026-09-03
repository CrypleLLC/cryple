import {
  type Beneficiary,
  type ChainStatus,
  type ReleaseStatusRecord,
} from '@/lib/succession';

export const LAST_CHECK_IN_CAVEAT =
  'The heartbeat is an on-chain action this API only mirrors. It appears once the smart account ' +
  'has been configured on-chain.';

export const CHAIN_UNAVAILABLE_CAVEAT =
  'The chain status could not be read. This says nothing about the switch itself — retry.';

export const CONFIGURATION_CAVEAT =
  'The inactivity and contest periods are configured on-chain, not here.';

export const THRESHOLD_UNCONFIGURED = 'Not configured on-chain';

export interface ReleaseView {
  headline: string;
  inactivityPeriodSeconds?: number;
  contestPeriodSeconds?: number;
  chainStatus: ChainStatus;
  chainUnavailable: boolean;
  released: boolean;
  smartAccountAddress: string;
  lastCheckIn?: Date;
  triggerableAt?: Date;
}

const HEADLINES: Record<ChainStatus, string> = {
  unconfigured: 'Your dead man\u2019s switch is not on-chain yet. Nothing is being monitored.',
  active: 'No release has been requested. Your vault is monitoring normally.',
  contest: 'A release has been triggered. Check in to cancel it before the contest period ends.',
  released: 'Your vault has been released. Your heirs can open what you left them.',
  unknown: 'The chain could not be read, so the switch\u2019s state is unknown right now.',
};

function fromUnixSeconds(seconds: number | undefined): Date | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000);
}

/**
 * The chain is the only source of release state. The API mirrors it and holds
 * no status of its own, so there is nothing here that could disagree with it.
 */
export function buildReleaseView(record: ReleaseStatusRecord): ReleaseView {
  const lastCheckIn = fromUnixSeconds(record.chain.last_check_in);
  const triggerableAt = fromUnixSeconds(record.chain.triggerable_at);

  return {
    headline: HEADLINES[record.chain.status],
    ...(record.chain.inactivity_period_seconds === undefined
      ? {}
      : { inactivityPeriodSeconds: record.chain.inactivity_period_seconds }),
    ...(record.chain.contest_period_seconds === undefined
      ? {}
      : { contestPeriodSeconds: record.chain.contest_period_seconds }),
    chainStatus: record.chain.status,
    chainUnavailable: record.chain.status === 'unknown',
    released: record.chain.status === 'released',
    smartAccountAddress: record.chain.smart_account_address,
    ...(lastCheckIn === undefined ? {} : { lastCheckIn }),
    ...(triggerableAt === undefined ? {} : { triggerableAt }),
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
