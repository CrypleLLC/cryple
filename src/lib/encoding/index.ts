export const P256_UNCOMPRESSED_POINT_LENGTH = 65;
export const P256_COORDINATE_LENGTH = 32;
export const P256_SPKI_DER_LENGTH = 91;
export const P256_SPKI_BASE64_LENGTH = 124;

const P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

const UNCOMPRESSED_POINT_TAG = 0x04;

const HEX_ALPHABET = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX_ALPHABET[bytes[i] >>> 4] + HEX_ALPHABET[bytes[i] & 0x0f];
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hex string must have an even length');
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('hex string contains non-hex characters');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function zeroBytes(...targets: (Uint8Array | undefined)[]): void {
  for (const target of targets) {
    target?.fill(0);
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function assertUncompressedPoint(point: Uint8Array): void {
  if (point.length !== P256_UNCOMPRESSED_POINT_LENGTH) {
    throw new Error(
      `uncompressed P-256 point must be ${P256_UNCOMPRESSED_POINT_LENGTH} bytes, got ${point.length}`,
    );
  }
  if (point[0] !== UNCOMPRESSED_POINT_TAG) {
    throw new Error('uncompressed P-256 point must start with 0x04');
  }
}

export function uncompressedPointToXY(point: Uint8Array): {
  x: Uint8Array;
  y: Uint8Array;
} {
  assertUncompressedPoint(point);
  return {
    x: point.slice(1, 1 + P256_COORDINATE_LENGTH),
    y: point.slice(1 + P256_COORDINATE_LENGTH),
  };
}

export function xyToUncompressedPoint(x: Uint8Array, y: Uint8Array): Uint8Array {
  if (x.length !== P256_COORDINATE_LENGTH || y.length !== P256_COORDINATE_LENGTH) {
    throw new Error(`P-256 coordinates must be ${P256_COORDINATE_LENGTH} bytes each`);
  }
  return concatBytes(new Uint8Array([UNCOMPRESSED_POINT_TAG]), x, y);
}

export function uncompressedPointToSpkiDer(point: Uint8Array): Uint8Array {
  assertUncompressedPoint(point);
  return concatBytes(P256_SPKI_PREFIX, point);
}

export function spkiDerToUncompressedPoint(spki: Uint8Array): Uint8Array {
  if (spki.length !== P256_SPKI_DER_LENGTH) {
    throw new Error(
      `P-256 SPKI DER must be ${P256_SPKI_DER_LENGTH} bytes, got ${spki.length}`,
    );
  }
  const prefix = spki.subarray(0, P256_SPKI_PREFIX.length);
  if (!bytesEqual(prefix, P256_SPKI_PREFIX)) {
    throw new Error('unexpected SPKI header — not an uncompressed P-256 public key');
  }
  return spki.slice(P256_SPKI_PREFIX.length);
}

export function uncompressedPointToSpkiBase64(point: Uint8Array): string {
  return bytesToBase64(uncompressedPointToSpkiDer(point));
}

export function spkiBase64ToUncompressedPoint(spkiBase64: string): Uint8Array {
  return spkiDerToUncompressedPoint(base64ToBytes(spkiBase64));
}
