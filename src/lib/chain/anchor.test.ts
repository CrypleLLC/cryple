import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { anchorCallData, encodeAnchor } from './calldata';
import { EPOCH_SECONDS } from './config';
import {
  currentEpoch,
  EPOCH_ALREADY_ANCHORED_SELECTOR,
  isAnchoredForEpoch,
  isEpochAlreadyAnchored,
} from './anchor';

const root = `0x${vectors.vault_merkle.root_hex}`;

const castAnchorCalldata =
  '0xa685520800000000000000000000000000000000000000000000000000000000000050cd' +
  '38824a82f4d55e8056f862ed1e2aaa7fb60d1c2793fedab1fec873b14c94ca87';

const castExecuteCalldata =
  '0xe9ae5c53' +
  '0100000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000040' +
  '0000000000000000000000000000000000000000000000000000000000000140' +
  '0000000000000000000000000000000000000000000000000000000000000020' +
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '0000000000000000000000000000000000000000000000000000000000000020' +
  '000000000000000000000000d344197975c4d47f97ddb1d26b91a96be6e83930' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000060' +
  '0000000000000000000000000000000000000000000000000000000000000044' +
  castAnchorCalldata.slice(2) +
  '00000000000000000000000000000000000000000000000000000000';

describe('anchor calldata', () => {
  it('matches the anchor(uint64,bytes32) encoding foundry produces', () => {
    expect(encodeAnchor(20685, root)).toBe(castAnchorCalldata);
  });

  it('wraps the anchor in ERC-7821 execute byte for byte with cast', () => {
    expect(anchorCallData(20685, root)).toBe(castExecuteCalldata);
  });
});

describe('epochs', () => {
  it('uses the contract day length', () => {
    expect(EPOCH_SECONDS).toBe(86_400);
  });

  it('derives the epoch the contract would compute', () => {
    expect(currentEpoch(new Date('2026-08-19T15:36:47Z'))).toBe(
      Math.floor(Date.parse('2026-08-19T15:36:47Z') / 1000 / 86_400),
    );
  });

  it('rolls over exactly at midnight UTC', () => {
    expect(currentEpoch(new Date('2026-08-19T23:59:59Z'))).toBe(
      currentEpoch(new Date('2026-08-20T00:00:00Z')) - 1,
    );
  });
});

describe('the midnight rollover the registry rejects', () => {
  it('recognises EpochAlreadyAnchored by name', () => {
    expect(
      isEpochAlreadyAnchored(new Error('execution reverted: EpochAlreadyAnchored(20685, 0x..)')),
    ).toBe(true);
  });

  it('recognises the exact revert Arbitrum Sepolia returned for a frozen epoch', () => {
    const live =
      '0xab455a2500000000000000000000000000000000000000000000000000000000000050cc' +
      'f35c8dd12d7abfcc6f515e5ce11308609179e626ba13377a2827d534d4f25ba6';
    expect(isEpochAlreadyAnchored({ message: 'execution reverted', data: live })).toBe(true);
    expect(live.slice(0, 10)).toBe(EPOCH_ALREADY_ANCHORED_SELECTOR);
  });

  it('recognises it by selector when the bundler returns raw revert data', () => {
    expect(
      isEpochAlreadyAnchored({
        message: 'UserOperation reverted',
        data: `${EPOCH_ALREADY_ANCHORED_SELECTOR}0000`,
      }),
    ).toBe(true);
  });

  it('does not swallow an unrelated revert', () => {
    expect(isEpochAlreadyAnchored(new Error('AA24 signature error'))).toBe(false);
    expect(isEpochAlreadyAnchored(new Error('execution reverted: EmptyRoot()'))).toBe(false);
  });
});

describe('knowing whether the vault is actually anchored', () => {
  it('accepts a matching root in the current epoch', () => {
    expect(isAnchoredForEpoch({ epoch: 20685, root }, root, 20685)).toBe(true);
  });

  it('rejects yesterday even when the root is unchanged', () => {
    expect(isAnchoredForEpoch({ epoch: 20684, root }, root, 20685)).toBe(false);
  });

  it('rejects a stale root anchored today', () => {
    expect(isAnchoredForEpoch({ epoch: 20685, root: `0x${'11'.repeat(32)}` }, root, 20685)).toBe(
      false,
    );
  });

  it('treats a never-anchored account as unanchored', () => {
    expect(isAnchoredForEpoch(undefined, root, 20685)).toBe(false);
  });
});
