import { request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';

export const CONTRACT_CHAIN_STATUSES = [
  'unconfigured',
  'active',
  'contest',
  'released',
] as const;

export type ChainStatus = (typeof CONTRACT_CHAIN_STATUSES)[number] | 'unknown';

export interface ChainStatusRecord {
  indexed: boolean;
  smart_account_address: string;
  status: ChainStatus;
  last_check_in?: number;
  inactivity_period_seconds?: number;
  contest_period_seconds?: number;
  triggerable_at?: number;
  triggered_at?: number;
  releasable_at?: number;
  released_at?: number;
  guardian_root?: string;
  guardian_threshold?: number;
}

export interface ReleaseStatusRecord {
  chain: ChainStatusRecord;
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
