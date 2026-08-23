import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@/lib/encoding';

export interface AbiValue {
  readonly dynamic: boolean;
  readonly encoded: string;
}

export function keccakHex(data: Uint8Array): string {
  return `0x${bytesToHex(keccak_256(data))}`;
}

export function selector(signature: string): string {
  return keccakHex(utf8ToBytes(signature)).slice(0, 10);
}

export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

export function word(value: bigint | number | string): AbiValue {
  const numeric = typeof value === 'string' ? BigInt(value) : BigInt(value);
  if (numeric < 0n) {
    throw new Error(`cannot ABI-encode a negative value: ${numeric}`);
  }
  return { dynamic: false, encoded: numeric.toString(16).padStart(64, '0') };
}

export function addressValue(address: string): AbiValue {
  const raw = stripHexPrefix(address);
  if (raw.length !== 40) {
    throw new Error(`expected a 20-byte address, got "${address}"`);
  }
  return { dynamic: false, encoded: raw.toLowerCase().padStart(64, '0') };
}

export function fixedBytes(value: string): AbiValue {
  const raw = stripHexPrefix(value);
  if (raw.length !== 64) {
    throw new Error(`expected a 32-byte value, got "${value}"`);
  }
  return { dynamic: false, encoded: raw.toLowerCase() };
}

export function dynamicBytes(value: string): AbiValue {
  const raw = stripHexPrefix(value).toLowerCase();
  if (raw.length % 2 !== 0) {
    throw new Error(`byte strings must have an even hex length, got "${value}"`);
  }
  const padding = raw.length % 64 === 0 ? 0 : 64 - (raw.length % 64);
  return {
    dynamic: true,
    encoded: (raw.length / 2).toString(16).padStart(64, '0') + raw + '0'.repeat(padding),
  };
}

export function encodeTuple(values: readonly AbiValue[]): string {
  let head = '';
  let tail = '';
  const headBytes = values.length * 32;

  for (const value of values) {
    if (value.dynamic) {
      head += (headBytes + tail.length / 2).toString(16).padStart(64, '0');
      tail += value.encoded;
    } else {
      head += value.encoded;
    }
  }

  return head + tail;
}

export function tupleValue(values: readonly AbiValue[]): AbiValue {
  const dynamic = values.some((value) => value.dynamic);
  return { dynamic, encoded: encodeTuple(values) };
}

export function arrayValue(items: readonly AbiValue[]): AbiValue {
  return {
    dynamic: true,
    encoded: items.length.toString(16).padStart(64, '0') + encodeTuple(items),
  };
}

export function encodeCall(signature: string, values: readonly AbiValue[]): string {
  return `${selector(signature)}${encodeTuple(values)}`;
}

export function decodeWord(data: string, index: number): bigint {
  const raw = stripHexPrefix(data);
  const start = index * 64;
  if (raw.length < start + 64) {
    throw new Error(`response is too short to hold word ${index}`);
  }
  return BigInt(`0x${raw.slice(start, start + 64)}`);
}

export function decodeAddress(data: string, index: number): string {
  const raw = stripHexPrefix(data);
  const start = index * 64;
  if (raw.length < start + 64) {
    throw new Error(`response is too short to hold word ${index}`);
  }
  return `0x${raw.slice(start + 24, start + 64)}`;
}

export function toBytes(hex: string): Uint8Array {
  return hexToBytes(stripHexPrefix(hex));
}
