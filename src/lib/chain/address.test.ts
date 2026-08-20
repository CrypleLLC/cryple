import { describe, expect, it } from 'vitest';
import { hexToBytes } from '@/lib/encoding';
import { FACTORY_ADDRESS, IMPLEMENTATION_ADDRESS } from './config';
import {
  assertSmartAccountMatches,
  minimalProxyCodeHash,
  signerCoordinates,
  smartAccountAddress,
  SmartAccountMismatchError,
} from './address';

const publicKeyUncompressed = hexToBytes(
  '04b88cb517c49a5a61e4c83544e1101b07353351722e9967dc0b7af43f7a8ee39d' +
    'a1a170a7432c9b6687c087227cd43f8ec0a68b890d6289a88a665e0a931173ae',
);

const liveSmartAccount = '0xaE7E393F8782da9062fb086a0D492dC71E737DEe';

describe('smart account derivation', () => {
  it('reproduces an address the deployed factory actually returned', () => {
    expect(smartAccountAddress(publicKeyUncompressed).toLowerCase()).toBe(
      liveSmartAccount.toLowerCase(),
    );
  });

  it('splits the uncompressed point into the coordinates the factory salts with', () => {
    const { qx, qy } = signerCoordinates(publicKeyUncompressed);
    expect(qx).toBe('0xb88cb517c49a5a61e4c83544e1101b07353351722e9967dc0b7af43f7a8ee39d');
    expect(qy).toBe('0xa1a170a7432c9b6687c087227cd43f8ec0a68b890d6289a88a665e0a931173ae');
  });

  it('moves the address when the implementation changes', () => {
    const other = smartAccountAddress(
      publicKeyUncompressed,
      FACTORY_ADDRESS,
      '0x42C24C4c846Ae7f5e935c537866672Acd7eaF8c9',
    );
    expect(other.toLowerCase()).not.toBe(liveSmartAccount.toLowerCase());
  });

  it('binds the code hash to the implementation address', () => {
    expect(minimalProxyCodeHash(IMPLEMENTATION_ADDRESS)).not.toEqual(
      minimalProxyCodeHash('0x42C24C4c846Ae7f5e935c537866672Acd7eaF8c9'),
    );
  });

  it('refuses a server-reported account the local key does not derive', () => {
    expect(() =>
      assertSmartAccountMatches(liveSmartAccount, '0x0000000000000000000000000000000000000001'),
    ).toThrow(SmartAccountMismatchError);
  });

  it('accepts a server-reported account regardless of checksum casing', () => {
    expect(() =>
      assertSmartAccountMatches(liveSmartAccount, liveSmartAccount.toUpperCase()),
    ).not.toThrow();
  });
});
