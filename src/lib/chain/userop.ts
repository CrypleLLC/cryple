import { p256 } from '@noble/curves/nist.js';
import { bytesToHex } from '@/lib/encoding';
import {
  addressValue,
  arrayValue,
  dynamicBytes,
  encodeCall,
  fixedBytes,
  stripHexPrefix,
  toBytes,
  tupleValue,
  word,
} from './abi';
import {
  ENTRY_POINT_ADDRESS,
  EXECUTION_GAS_HEADROOM_PERCENT,
  MAX_FEE_PER_GAS,
  MAX_PRIORITY_FEE_PER_GAS,
  MIN_CALL_GAS_LIMIT,
  MIN_PRE_VERIFICATION_GAS,
  MIN_VERIFICATION_GAS_LIMIT,
  PRE_VERIFICATION_GAS_HEADROOM_PERCENT,
  PROBE_CALL_GAS_LIMIT,
  PROBE_PRE_VERIFICATION_GAS,
  PROBE_VERIFICATION_GAS_LIMIT,
  CHAIN_ID,
  getPaymasterUrl,
  getSponsorshipPolicyId,
} from './config';
import { bundlerCall, ethCall, jsonRpc, nodeCall } from './rpc';

export const CURVE_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

export const DUMMY_SIGNATURE = `0x${'11'.repeat(64)}`;

export const ESTIMATION_BALANCE_OVERRIDE = '0xde0b6b3a7640000';

export interface UserOperation {
  sender: string;
  nonce: string;
  factory?: string;
  factoryData?: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymaster?: string;
  paymasterData?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  signature: string;
}

export interface GasLimits {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
}

export const PROBE_GAS_LIMITS: GasLimits = {
  verificationGasLimit: PROBE_VERIFICATION_GAS_LIMIT,
  callGasLimit: PROBE_CALL_GAS_LIMIT,
  preVerificationGas: PROBE_PRE_VERIFICATION_GAS,
};

export function packGas(high: bigint, low: bigint): string {
  return `0x${high.toString(16).padStart(32, '0')}${low.toString(16).padStart(32, '0')}`;
}

export function initCodeOf(operation: UserOperation): string {
  if (!operation.factory) {
    return '0x';
  }
  return `${operation.factory.toLowerCase()}${stripHexPrefix(operation.factoryData ?? '0x')}`;
}

export function paymasterAndDataOf(operation: UserOperation): string {
  if (!operation.paymaster) {
    return '0x';
  }
  const verification = BigInt(operation.paymasterVerificationGasLimit ?? '0x0');
  const postOp = BigInt(operation.paymasterPostOpGasLimit ?? '0x0');
  return (
    `${operation.paymaster.toLowerCase()}` +
    `${verification.toString(16).padStart(32, '0')}` +
    `${postOp.toString(16).padStart(32, '0')}` +
    `${stripHexPrefix(operation.paymasterData ?? '0x')}`
  );
}

export function packUserOperation(operation: UserOperation, signature: string = '0x') {
  return tupleValue([
    addressValue(operation.sender),
    word(BigInt(operation.nonce)),
    dynamicBytes(initCodeOf(operation)),
    dynamicBytes(operation.callData),
    fixedBytes(packGas(BigInt(operation.verificationGasLimit), BigInt(operation.callGasLimit))),
    word(BigInt(operation.preVerificationGas)),
    fixedBytes(packGas(BigInt(operation.maxPriorityFeePerGas), BigInt(operation.maxFeePerGas))),
    dynamicBytes(paymasterAndDataOf(operation)),
    dynamicBytes(signature),
  ]);
}

export async function fetchUserOpHash(
  operation: UserOperation,
  signal?: AbortSignal,
): Promise<string> {
  const data = encodeCall(
    'getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))',
    [packUserOperation(operation)],
  );
  const result = await ethCall(ENTRY_POINT_ADDRESS, data, signal);
  return `0x${stripHexPrefix(result).slice(0, 64)}`;
}

export async function fetchNonce(sender: string, signal?: AbortSignal): Promise<bigint> {
  const data = encodeCall('getNonce(address,uint192)', [addressValue(sender), word(0)]);
  const result = await ethCall(ENTRY_POINT_ADDRESS, data, signal);
  return BigInt(result);
}

export class SignatureMalleabilityError extends Error {
  constructor() {
    super('the P-256 signature is not low-s and the account would reject it with AA24');
    this.name = 'SignatureMalleabilityError';
  }
}

export function signUserOpHash(userOpHash: string, privateKey: Uint8Array): string {
  const signature = p256.sign(toBytes(userOpHash), privateKey, {
    format: 'compact',
    prehash: false,
  });

  const s = BigInt(`0x${bytesToHex(signature.slice(32))}`);
  if (s > HALF_CURVE_ORDER) {
    throw new SignatureMalleabilityError();
  }

  return `0x${bytesToHex(signature)}`;
}

export function withGasLimits(operation: UserOperation, limits: GasLimits): UserOperation {
  return {
    ...operation,
    verificationGasLimit: `0x${limits.verificationGasLimit.toString(16)}`,
    callGasLimit: `0x${limits.callGasLimit.toString(16)}`,
    preVerificationGas: `0x${limits.preVerificationGas.toString(16)}`,
  };
}

export function requiredPrefund(limits: GasLimits, maxFeePerGas: bigint): bigint {
  return (
    (limits.verificationGasLimit + limits.callGasLimit + limits.preVerificationGas) * maxFeePerGas
  );
}

export async function measureGasLimits(
  operation: UserOperation,
  signal?: AbortSignal,
): Promise<GasLimits> {
  const probe = withGasLimits(
    { ...operation, signature: DUMMY_SIGNATURE },
    PROBE_GAS_LIMITS,
  );

  const estimate = await bundlerCall<{
    verificationGasLimit: string;
    callGasLimit: string;
    preVerificationGas: string;
  }>(
    'eth_estimateUserOperationGas',
    [probe, ENTRY_POINT_ADDRESS, { [operation.sender]: { balance: ESTIMATION_BALANCE_OVERRIDE } }],
    signal,
  );

  return {
    verificationGasLimit: declared(
      'verificationGasLimit',
      estimate.verificationGasLimit,
      EXECUTION_GAS_HEADROOM_PERCENT,
      MIN_VERIFICATION_GAS_LIMIT,
    ),
    callGasLimit: declared(
      'callGasLimit',
      estimate.callGasLimit,
      EXECUTION_GAS_HEADROOM_PERCENT,
      MIN_CALL_GAS_LIMIT,
    ),
    preVerificationGas: declared(
      'preVerificationGas',
      estimate.preVerificationGas,
      PRE_VERIFICATION_GAS_HEADROOM_PERCENT,
      MIN_PRE_VERIFICATION_GAS,
    ),
  };
}

export class ImplausibleGasEstimateError extends Error {
  readonly field: string;
  readonly estimated: string | undefined;

  constructor(field: string, estimated: string | undefined) {
    super(
      `the bundler answered ${field} = ${estimated ?? 'nothing'}, which cannot run this operation; retry rather than declaring a ceiling the paymaster would refuse`,
    );
    this.name = 'ImplausibleGasEstimateError';
    this.field = field;
    this.estimated = estimated;
  }
}

export function declared(
  field: string,
  estimated: string | undefined,
  headroomPercent: bigint,
  minimum: bigint,
): bigint {
  const withHeadroom =
    estimated === undefined ? 0n : (BigInt(estimated) * headroomPercent) / 100n;

  if (withHeadroom < minimum) {
    throw new ImplausibleGasEstimateError(field, estimated);
  }

  return withHeadroom;
}

export interface PaymasterFields {
  paymaster: string;
  paymasterData: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
}

export async function requestSponsorship(
  operation: UserOperation,
  signal?: AbortSignal,
): Promise<UserOperation | undefined> {
  const paymasterUrl = getPaymasterUrl();
  if (!paymasterUrl) {
    return undefined;
  }

  const policyId = getSponsorshipPolicyId();
  const context = policyId ? { sponsorshipPolicyId: policyId } : {};
  const request = { ...operation, signature: DUMMY_SIGNATURE };

  const stub = await jsonRpc<PaymasterFields & { isFinal?: boolean }>(
    paymasterUrl,
    'pm_getPaymasterStubData',
    [request, ENTRY_POINT_ADDRESS, `0x${CHAIN_ID.toString(16)}`, context],
    signal,
  );

  const stubbed: UserOperation = {
    ...operation,
    paymaster: stub.paymaster,
    paymasterData: stub.paymasterData,
    paymasterVerificationGasLimit: stub.paymasterVerificationGasLimit ?? '0x30d40',
    paymasterPostOpGasLimit: stub.paymasterPostOpGasLimit ?? '0x1',
  };

  if (stub.isFinal) {
    return stubbed;
  }

  const final = await jsonRpc<PaymasterFields>(
    paymasterUrl,
    'pm_getPaymasterData',
    [
      { ...stubbed, signature: DUMMY_SIGNATURE },
      ENTRY_POINT_ADDRESS,
      `0x${CHAIN_ID.toString(16)}`,
      context,
    ],
    signal,
  );

  return {
    ...stubbed,
    paymaster: final.paymaster,
    paymasterData: final.paymasterData,
    paymasterVerificationGasLimit:
      final.paymasterVerificationGasLimit ?? stubbed.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: final.paymasterPostOpGasLimit ?? stubbed.paymasterPostOpGasLimit,
  };
}

export const SIMULATION_BENEFICIARY = '0x000000000000000000000000000000000000dEaD';

export async function simulateHandleOps(
  operation: UserOperation,
  balanceOverrideWei?: bigint,
  signal?: AbortSignal,
): Promise<void> {
  const data = encodeCall('handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)', [
    arrayValue([packUserOperation(operation, operation.signature)]),
    addressValue(SIMULATION_BENEFICIARY),
  ]);

  const overrides = balanceOverrideWei
    ? { [operation.sender]: { balance: `0x${balanceOverrideWei.toString(16)}` } }
    : {};

  await nodeCall<string>(
    'eth_call',
    [
      { from: SIMULATION_BENEFICIARY, to: ENTRY_POINT_ADDRESS, data, gas: '0x7a1200' },
      'latest',
      overrides,
    ],
    signal,
  );
}

export function sendUserOperation(
  operation: UserOperation,
  signal?: AbortSignal,
): Promise<string> {
  return bundlerCall<string>('eth_sendUserOperation', [operation, ENTRY_POINT_ADDRESS], signal);
}

export interface UserOperationReceipt {
  userOpHash: string;
  success: boolean;
  actualGasUsed: string;
  actualGasCost: string;
  receipt: { transactionHash: string; blockNumber: string };
}

export function getUserOperationReceipt(
  userOpHash: string,
  signal?: AbortSignal,
): Promise<UserOperationReceipt | null> {
  return bundlerCall<UserOperationReceipt | null>(
    'eth_getUserOperationReceipt',
    [userOpHash],
    signal,
  );
}

export async function getBalance(address: string, signal?: AbortSignal): Promise<bigint> {
  return BigInt(await nodeCall<string>('eth_getBalance', [address, 'latest'], signal));
}

export const DEFAULT_GAS_FEES = {
  maxFeePerGas: MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
};
