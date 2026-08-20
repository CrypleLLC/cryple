import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, uncompressedPointToXY } from '@/lib/encoding';
import {
  FACTORY_ADDRESS,
  IMPLEMENTATION_ADDRESS,
  MVP_GUARDIAN_ROOT,
  MVP_GUARDIAN_THRESHOLD,
  MVP_RECOVERY_DELAY,
  MVP_SALT,
} from './config';
import { stripHexPrefix } from './abi';

export const MINIMAL_PROXY_PREFIX = '3d602d80600a3d3981f3363d3d373d3d3d363d73';
export const MINIMAL_PROXY_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

export interface SignerCoordinates {
  qx: string;
  qy: string;
}

export function signerCoordinates(publicKeyUncompressed: Uint8Array): SignerCoordinates {
  const { x, y } = uncompressedPointToXY(publicKeyUncompressed);
  return { qx: `0x${bytesToHex(x)}`, qy: `0x${bytesToHex(y)}` };
}

function paddedWord(value: bigint | number): Uint8Array {
  return hexToBytes(BigInt(value).toString(16).padStart(64, '0'));
}

export function deploySalt(coordinates: SignerCoordinates): Uint8Array {
  return keccak_256(
    concatBytes(
      hexToBytes(stripHexPrefix(coordinates.qx)),
      hexToBytes(stripHexPrefix(coordinates.qy)),
      hexToBytes(stripHexPrefix(MVP_GUARDIAN_ROOT)),
      paddedWord(MVP_GUARDIAN_THRESHOLD),
      paddedWord(MVP_RECOVERY_DELAY),
      hexToBytes(stripHexPrefix(MVP_SALT)),
    ),
  );
}

export function minimalProxyCodeHash(implementation: string = IMPLEMENTATION_ADDRESS): Uint8Array {
  return keccak_256(
    hexToBytes(
      MINIMAL_PROXY_PREFIX + stripHexPrefix(implementation).toLowerCase() + MINIMAL_PROXY_SUFFIX,
    ),
  );
}

export function create2Address(
  deployer: string,
  salt: Uint8Array,
  initCodeHash: Uint8Array,
): string {
  const digest = keccak_256(
    concatBytes(
      new Uint8Array([0xff]),
      hexToBytes(stripHexPrefix(deployer).toLowerCase()),
      salt,
      initCodeHash,
    ),
  );
  return `0x${bytesToHex(digest.slice(12))}`;
}

export function smartAccountAddress(
  publicKeyUncompressed: Uint8Array,
  factory: string = FACTORY_ADDRESS,
  implementation: string = IMPLEMENTATION_ADDRESS,
): string {
  const coordinates = signerCoordinates(publicKeyUncompressed);
  return create2Address(factory, deploySalt(coordinates), minimalProxyCodeHash(implementation));
}

export class SmartAccountMismatchError extends Error {
  readonly derived: string;
  readonly reported: string;

  constructor(derived: string, reported: string) {
    super(
      `the server reported smart account ${reported} but this key derives ${derived}; refusing to sign for an account this device cannot prove it owns`,
    );
    this.name = 'SmartAccountMismatchError';
    this.derived = derived;
    this.reported = reported;
  }
}

export function assertSmartAccountMatches(derived: string, reported: string): void {
  if (derived.toLowerCase() !== reported.toLowerCase()) {
    throw new SmartAccountMismatchError(derived, reported);
  }
}
