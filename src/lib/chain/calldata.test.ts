import { describe, expect, it } from 'vitest';
import { checkInCallData, encodeExecutionData, encodeCheckIn } from './calldata';
import { DEAD_MAN_SWITCH_ADDRESS } from './config';

const castExecutionData =
  '0x0000000000000000000000000000000000000000000000000000000000000020' +
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '0000000000000000000000000000000000000000000000000000000000000020' +
  '0000000000000000000000006951a65cdc706a2d23e1015d35b8353f18a569a9' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000060' +
  '0000000000000000000000000000000000000000000000000000000000000004' +
  '183ff08500000000000000000000000000000000000000000000000000000000';

const harnessCheckInCallData =
  '0xe9ae5c53' +
  '0100000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000040' +
  '0000000000000000000000000000000000000000000000000000000000000100' +
  castExecutionData.slice(2);

describe('userOp calldata', () => {
  it('matches the checkIn() selector foundry computes', () => {
    expect(encodeCheckIn()).toBe('0x183ff085');
  });

  it('encodes the ERC-7821 execution data byte for byte with cast abi-encode', () => {
    expect(encodeExecutionData(DEAD_MAN_SWITCH_ADDRESS, 0n, encodeCheckIn())).toBe(
      castExecutionData,
    );
  });

  it('reproduces the calldata the python harness sends for a check-in', () => {
    expect(checkInCallData()).toBe(harnessCheckInCallData);
  });
});
