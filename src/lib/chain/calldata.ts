import {
  addressValue,
  arrayValue,
  dynamicBytes,
  encodeCall,
  encodeTuple,
  fixedBytes,
  tupleValue,
  word,
} from './abi';
import { DEAD_MAN_SWITCH_ADDRESS, PROOF_REGISTRY_ADDRESS } from './config';

export const ERC7821_SINGLE_BATCH_MODE = `0x01${'00'.repeat(31)}`;

export function encodeExecutionData(target: string, value: bigint, data: string): string {
  return `0x${encodeTuple([
    arrayValue([tupleValue([addressValue(target), word(value), dynamicBytes(data)])]),
  ])}`;
}

export function encodeExecute(target: string, value: bigint, data: string): string {
  const executionData = encodeExecutionData(target, value, data);
  return encodeCall('execute(bytes32,bytes)', [
    fixedBytes(ERC7821_SINGLE_BATCH_MODE),
    dynamicBytes(executionData),
  ]);
}

export function encodeCheckIn(): string {
  return encodeCall('checkIn()', []);
}

export function encodeConfigure(
  inactivityPeriod: number,
  contestPeriod: number,
  guardianRoot: string,
  guardianThreshold: number,
): string {
  return encodeCall('configure(uint32,uint32,bytes32,uint8)', [
    word(inactivityPeriod),
    word(contestPeriod),
    fixedBytes(guardianRoot),
    word(guardianThreshold),
  ]);
}

export function checkInCallData(switchAddress: string = DEAD_MAN_SWITCH_ADDRESS): string {
  return encodeExecute(switchAddress, 0n, encodeCheckIn());
}

export function configureCallData(
  inactivityPeriod: number,
  contestPeriod: number,
  guardianRoot: string,
  guardianThreshold: number,
  switchAddress: string = DEAD_MAN_SWITCH_ADDRESS,
): string {
  return encodeExecute(
    switchAddress,
    0n,
    encodeConfigure(inactivityPeriod, contestPeriod, guardianRoot, guardianThreshold),
  );
}

export function factoryCallData(
  qx: string,
  qy: string,
  guardianRoot: string,
  guardianThreshold: number,
  recoveryDelay: number,
  salt: string,
): string {
  return encodeCall('createAccount(bytes32,bytes32,bytes32,uint32,uint64,bytes32)', [
    fixedBytes(qx),
    fixedBytes(qy),
    fixedBytes(guardianRoot),
    word(guardianThreshold),
    word(recoveryDelay),
    fixedBytes(salt),
  ]);
}

export function encodeAnchor(epoch: number, root: string): string {
  return encodeCall('anchor(uint64,bytes32)', [word(epoch), fixedBytes(root)]);
}

export function anchorCallData(
  epoch: number,
  root: string,
  registryAddress: string = PROOF_REGISTRY_ADDRESS,
): string {
  return encodeExecute(registryAddress, 0n, encodeAnchor(epoch, root));
}
