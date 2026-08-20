import { addressValue, decodeWord, encodeCall, fixedBytes, stripHexPrefix, word } from './abi';
import { anchorCallData } from './calldata';
import { EPOCH_SECONDS, PROOF_REGISTRY_ADDRESS } from './config';
import { ethCall, ethCallFrom } from './rpc';
import {
  planOperation,
  submitOperation,
  type ChainIdentity,
  type OperationOptions,
  type OperationPlan,
  type OperationResult,
} from './operation';

export interface AnchorPlan extends OperationPlan {
  epoch: number;
  root: string;
}

export interface AnchorResult extends OperationResult {
  epoch: number;
  root: string;
}

export interface AnchoredRoot {
  epoch: number;
  root: string;
}

export class EmptyRootError extends Error {
  constructor() {
    super('an empty vault has no root, and the registry rejects one');
    this.name = 'EmptyRootError';
  }
}

export function currentEpoch(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / EPOCH_SECONDS);
}

export async function fetchCurrentEpoch(signal?: AbortSignal): Promise<number> {
  const raw = await ethCall(PROOF_REGISTRY_ADDRESS, encodeCall('currentEpoch()', []), signal);
  return Number(decodeWord(raw, 0));
}

export async function fetchLatestRoot(
  smartAccountAddress: string,
  signal?: AbortSignal,
): Promise<AnchoredRoot | undefined> {
  const raw = await ethCall(
    PROOF_REGISTRY_ADDRESS,
    encodeCall('latestRoot(address)', [addressValue(smartAccountAddress)]),
    signal,
  );

  const epoch = Number(decodeWord(raw, 0));
  const root = `0x${stripHexPrefix(raw).slice(64, 128)}`;

  return BigInt(root) === 0n ? undefined : { epoch, root };
}

export async function fetchRootAt(
  smartAccountAddress: string,
  epoch: number,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const raw = await ethCall(
    PROOF_REGISTRY_ADDRESS,
    encodeCall('rootAt(address,uint64)', [addressValue(smartAccountAddress), word(epoch)]),
    signal,
  );

  const root = `0x${stripHexPrefix(raw).slice(0, 64)}`;
  return BigInt(root) === 0n ? undefined : root;
}

export const EPOCH_ALREADY_ANCHORED_SELECTOR = '0xab455a25';
export const EMPTY_ROOT_SELECTOR = '0x53ce4ece';
export const EPOCH_IN_THE_FUTURE_SELECTOR = '0xd2027888';

export function isEpochAlreadyAnchored(error: unknown): boolean {
  const haystack = [
    error instanceof Error ? error.message : String(error),
    error !== null && typeof error === 'object' && 'data' in error ? String(error.data) : '',
  ]
    .join(' ')
    .toLowerCase();

  return (
    haystack.includes('epochalreadyanchored') ||
    haystack.includes(EPOCH_ALREADY_ANCHORED_SELECTOR.slice(2))
  );
}

export async function planAnchor(
  identity: ChainIdentity,
  root: string,
  options: OperationOptions = {},
): Promise<AnchorPlan> {
  if (BigInt(root) === 0n) {
    throw new EmptyRootError();
  }

  const epoch = await fetchCurrentEpoch(options.signal);
  const callData = anchorCallData(epoch, root);

  return { ...(await planOperation(identity, callData, options)), epoch, root };
}

export async function submitAnchor(
  plan: AnchorPlan,
  identity: ChainIdentity,
  options: OperationOptions = {},
): Promise<AnchorResult> {
  return { ...(await submitOperation(plan, identity, options)), epoch: plan.epoch, root: plan.root };
}

export async function anchorVaultRoot(
  identity: ChainIdentity,
  root: string,
  options: OperationOptions = {},
): Promise<AnchorResult> {
  const plan = await planAnchor(identity, root, options);

  try {
    return await submitAnchor(plan, identity, options);
  } catch (cause) {
    if (!isEpochAlreadyAnchored(cause)) {
      throw cause;
    }

    const retry = await planAnchor(identity, root, options);
    return submitAnchor(retry, identity, options);
  }
}

export function isAnchoredForEpoch(
  latest: AnchoredRoot | undefined,
  expectedRoot: string,
  epoch: number,
): boolean {
  return (
    latest !== undefined &&
    latest.epoch === epoch &&
    latest.root.toLowerCase() === expectedRoot.toLowerCase()
  );
}

export async function simulateAnchor(
  smartAccountAddress: string,
  epoch: number,
  root: string,
  signal?: AbortSignal,
): Promise<void> {
  await ethCallFrom(
    smartAccountAddress,
    PROOF_REGISTRY_ADDRESS,
    encodeCall('anchor(uint64,bytes32)', [word(epoch), fixedBytes(root)]),
    signal,
  );
}
