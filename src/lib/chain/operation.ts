import { p256 } from '@noble/curves/nist.js';
import {
  FACTORY_ADDRESS,
  MVP_GUARDIAN_ROOT,
  MVP_GUARDIAN_THRESHOLD,
  MVP_RECOVERY_DELAY,
  MVP_SALT,
  RECEIPT_POLL_ATTEMPTS,
  RECEIPT_POLL_INTERVAL_MS,
} from './config';
import { assertSmartAccountMatches, signerCoordinates, smartAccountAddress } from './address';
import { factoryCallData } from './calldata';
import { isDeployed } from './rpc';
import {
  DEFAULT_GAS_FEES,
  DUMMY_SIGNATURE,
  fetchNonce,
  fetchUserOpHash,
  getBalance,
  getUserOperationReceipt,
  measureGasLimits,
  requestSponsorship,
  requiredPrefund,
  sendUserOperation,
  signUserOpHash,
  withGasLimits,
  type GasLimits,
  type UserOperation,
  type UserOperationReceipt,
} from './userop';

export type OperationPayer = 'paymaster' | 'account';

export interface ChainIdentity {
  privateKey: Uint8Array;
  publicKeyUncompressed: Uint8Array;
}

export type OperationStage =
  | { name: 'deriving' }
  | { name: 'measuring' }
  | { name: 'sponsoring' }
  | { name: 'self-funding'; shortfallWei: bigint }
  | { name: 'signing' }
  | { name: 'submitting' }
  | { name: 'waiting'; userOpHash: string };

export interface OperationOptions {
  reportedSmartAccountAddress?: string;
  signal?: AbortSignal;
  onStage?: (stage: OperationStage) => void;
}

export interface OperationPlan {
  smartAccountAddress: string;
  userOperation: UserOperation;
  gasLimits: GasLimits;
  payer: OperationPayer;
  requiredPrefundWei: bigint;
  deployed: boolean;
}

export interface OperationResult {
  smartAccountAddress: string;
  payer: OperationPayer;
  userOpHash: string;
  transactionHash: string;
  actualGasUsed: bigint;
  actualGasCostWei: bigint;
}

export class InsufficientPrefundError extends Error {
  readonly smartAccountAddress: string;
  readonly requiredWei: bigint;
  readonly balanceWei: bigint;
  readonly shortfallWei: bigint;

  constructor(smartAccountAddress: string, requiredWei: bigint, balanceWei: bigint) {
    super(
      `${smartAccountAddress} holds ${balanceWei} wei but the EntryPoint requires ${requiredWei} wei of prefund before it will run this operation`,
    );
    this.name = 'InsufficientPrefundError';
    this.smartAccountAddress = smartAccountAddress;
    this.requiredWei = requiredWei;
    this.balanceWei = balanceWei;
    this.shortfallWei = requiredWei - balanceWei;
  }
}

export class OperationRevertedError extends Error {
  readonly userOpHash: string;
  readonly transactionHash: string;

  constructor(userOpHash: string, transactionHash: string) {
    super(`the operation was mined in ${transactionHash} but reverted inside the call phase`);
    this.name = 'OperationRevertedError';
    this.userOpHash = userOpHash;
    this.transactionHash = transactionHash;
  }
}

export class OperationPendingError extends Error {
  readonly userOpHash: string;

  constructor(userOpHash: string) {
    super(`no receipt for ${userOpHash} within the polling window; it may still land`);
    this.name = 'OperationPendingError';
    this.userOpHash = userOpHash;
  }
}

export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKey, false);
}

export function deriveSmartAccount(identity: ChainIdentity): string {
  return smartAccountAddress(identity.publicKeyUncompressed);
}

export async function planOperation(
  identity: ChainIdentity,
  callData: string,
  options: OperationOptions = {},
): Promise<OperationPlan> {
  const { signal, onStage } = options;

  onStage?.({ name: 'deriving' });
  const sender = deriveSmartAccount(identity);
  if (options.reportedSmartAccountAddress) {
    assertSmartAccountMatches(sender, options.reportedSmartAccountAddress);
  }

  const deployed = await isDeployed(sender, signal);
  const nonce = await fetchNonce(sender, signal);

  let base: UserOperation = {
    sender,
    nonce: `0x${nonce.toString(16)}`,
    callData,
    callGasLimit: '0x0',
    verificationGasLimit: '0x0',
    preVerificationGas: '0x0',
    maxFeePerGas: `0x${DEFAULT_GAS_FEES.maxFeePerGas.toString(16)}`,
    maxPriorityFeePerGas: `0x${DEFAULT_GAS_FEES.maxPriorityFeePerGas.toString(16)}`,
    signature: DUMMY_SIGNATURE,
  };

  if (!deployed) {
    const { qx, qy } = signerCoordinates(identity.publicKeyUncompressed);
    base = {
      ...base,
      factory: FACTORY_ADDRESS,
      factoryData: factoryCallData(
        qx,
        qy,
        MVP_GUARDIAN_ROOT,
        MVP_GUARDIAN_THRESHOLD,
        MVP_RECOVERY_DELAY,
        MVP_SALT,
      ),
    };
  }

  onStage?.({ name: 'measuring' });
  const gasLimits = await measureGasLimits(base, signal);
  const measured = withGasLimits(base, gasLimits);

  onStage?.({ name: 'sponsoring' });
  let sponsored: UserOperation | undefined;
  try {
    sponsored = await requestSponsorship(measured, signal);
  } catch {
    sponsored = undefined;
  }

  const prefund = requiredPrefund(gasLimits, DEFAULT_GAS_FEES.maxFeePerGas);

  if (sponsored) {
    return {
      smartAccountAddress: sender,
      userOperation: sponsored,
      gasLimits,
      payer: 'paymaster',
      requiredPrefundWei: prefund,
      deployed,
    };
  }

  const balance = await getBalance(sender, signal);
  onStage?.({ name: 'self-funding', shortfallWei: balance >= prefund ? 0n : prefund - balance });

  if (balance < prefund) {
    throw new InsufficientPrefundError(sender, prefund, balance);
  }

  return {
    smartAccountAddress: sender,
    userOperation: measured,
    gasLimits,
    payer: 'account',
    requiredPrefundWei: prefund,
    deployed,
  };
}

export async function waitForReceipt(
  userOpHash: string,
  signal?: AbortSignal,
  attempts: number = RECEIPT_POLL_ATTEMPTS,
  intervalMs: number = RECEIPT_POLL_INTERVAL_MS,
): Promise<UserOperationReceipt | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await getUserOperationReceipt(userOpHash, signal);
    if (receipt) {
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

export async function submitOperation(
  plan: OperationPlan,
  identity: ChainIdentity,
  options: OperationOptions = {},
): Promise<OperationResult> {
  const { signal, onStage } = options;

  onStage?.({ name: 'signing' });
  const userOpHash = await fetchUserOpHash(plan.userOperation, signal);
  const signed: UserOperation = {
    ...plan.userOperation,
    signature: signUserOpHash(userOpHash, identity.privateKey),
  };

  onStage?.({ name: 'submitting' });
  const submittedHash = await sendUserOperation(signed, signal);

  onStage?.({ name: 'waiting', userOpHash: submittedHash });
  const receipt = await waitForReceipt(submittedHash, signal);
  if (!receipt) {
    throw new OperationPendingError(submittedHash);
  }
  if (!receipt.success) {
    throw new OperationRevertedError(submittedHash, receipt.receipt.transactionHash);
  }

  return {
    smartAccountAddress: plan.smartAccountAddress,
    payer: plan.payer,
    userOpHash: submittedHash,
    transactionHash: receipt.receipt.transactionHash,
    actualGasUsed: BigInt(receipt.actualGasUsed),
    actualGasCostWei: BigInt(receipt.actualGasCost),
  };
}
