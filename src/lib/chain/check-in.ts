import { DEAD_MAN_SWITCH_ADDRESS, MVP_GUARDIAN_ROOT, MVP_GUARDIAN_THRESHOLD } from './config';
import { addressValue, decodeWord, encodeCall } from './abi';
import { checkInCallData, configureCallData } from './calldata';
import { ethCall, isDeployed } from './rpc';
import {
  deriveSmartAccount,
  planOperation,
  submitOperation,
  type ChainIdentity,
  type OperationOptions,
  type OperationPlan,
  type OperationResult,
  type OperationStage,
} from './operation';

export const MVP_INACTIVITY_PERIOD_SECONDS = 600;
export const MVP_CONTEST_PERIOD_SECONDS = 300;

export const SWITCH_STATUSES = ['unconfigured', 'active', 'contest', 'released'] as const;
export type SwitchStatus = (typeof SWITCH_STATUSES)[number];

export type HeartbeatOperation =
  | 'deploy-and-configure'
  | 'configure'
  | 'reconfigure'
  | 'check-in';
export type HeartbeatIdentity = ChainIdentity;
export type HeartbeatStage = OperationStage;

export interface HeartbeatOptions extends OperationOptions {
  inactivityPeriodSeconds?: number;
  contestPeriodSeconds?: number;
  reconfigure?: boolean;
}

export interface SwitchLimits {
  minInactivitySeconds: number;
  minContestSeconds: number;
}

export interface HeartbeatPlan extends OperationPlan {
  operation: HeartbeatOperation;
}

export interface HeartbeatResult extends OperationResult {
  operation: HeartbeatOperation;
}

export interface SwitchRecord {
  deployed: boolean;
  status: SwitchStatus;
  lastCheckIn?: number;
  inactivityPeriodSeconds: number;
  contestPeriodSeconds: number;
  triggeredAt?: number;
}

export async function isConfigured(
  smartAccountAddress: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const data = encodeCall('statusOf(address)', [addressValue(smartAccountAddress)]);
  const result = await ethCall(DEAD_MAN_SWITCH_ADDRESS, data, signal);
  return BigInt(result) !== 0n;
}

export async function fetchSwitchLimits(signal?: AbortSignal): Promise<SwitchLimits> {
  const [inactivity, contest] = await Promise.all([
    ethCall(DEAD_MAN_SWITCH_ADDRESS, encodeCall('minInactivityPeriod()', []), signal),
    ethCall(DEAD_MAN_SWITCH_ADDRESS, encodeCall('minContestPeriod()', []), signal),
  ]);

  return {
    minInactivitySeconds: Number(BigInt(inactivity)),
    minContestSeconds: Number(BigInt(contest)),
  };
}

export async function fetchSwitchRecord(
  smartAccountAddress: string,
  signal?: AbortSignal,
): Promise<SwitchRecord> {
  const [deployed, raw] = await Promise.all([
    isDeployed(smartAccountAddress, signal),
    ethCall(
      DEAD_MAN_SWITCH_ADDRESS,
      encodeCall('recordOf(address)', [addressValue(smartAccountAddress)]),
      signal,
    ),
  ]);

  const lastCheckIn = Number(decodeWord(raw, 0));
  const triggeredAt = Number(decodeWord(raw, 6));

  return {
    deployed,
    status: SWITCH_STATUSES[Number(decodeWord(raw, 5))] ?? 'unconfigured',
    ...(lastCheckIn === 0 ? {} : { lastCheckIn }),
    inactivityPeriodSeconds: Number(decodeWord(raw, 1)),
    contestPeriodSeconds: Number(decodeWord(raw, 2)),
    ...(triggeredAt === 0 ? {} : { triggeredAt }),
  };
}

export async function planHeartbeat(
  identity: HeartbeatIdentity,
  options: HeartbeatOptions = {},
): Promise<HeartbeatPlan> {
  const sender = deriveSmartAccount(identity);
  const deployed = await isDeployed(sender, options.signal);
  const configured = deployed && (await isConfigured(sender, options.signal));

  const reconfiguring = configured && options.reconfigure === true;

  const operation: HeartbeatOperation = !deployed
    ? 'deploy-and-configure'
    : !configured
      ? 'configure'
      : reconfiguring
        ? 'reconfigure'
        : 'check-in';

  const callData =
    configured && !reconfiguring
      ? checkInCallData()
      : configureCallData(
          options.inactivityPeriodSeconds ?? MVP_INACTIVITY_PERIOD_SECONDS,
          options.contestPeriodSeconds ?? MVP_CONTEST_PERIOD_SECONDS,
          MVP_GUARDIAN_ROOT,
          MVP_GUARDIAN_THRESHOLD,
        );

  return { ...(await planOperation(identity, callData, options)), operation };
}

export async function submitHeartbeat(
  plan: HeartbeatPlan,
  identity: HeartbeatIdentity,
  options: HeartbeatOptions = {},
): Promise<HeartbeatResult> {
  return { ...(await submitOperation(plan, identity, options)), operation: plan.operation };
}

export async function checkIn(
  identity: HeartbeatIdentity,
  options: HeartbeatOptions = {},
): Promise<HeartbeatResult> {
  const plan = await planHeartbeat(identity, options);
  return submitHeartbeat(plan, identity, options);
}
