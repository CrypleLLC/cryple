import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import {
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  concatBytes,
  hexToBytes,
  spkiBase64ToUncompressedPoint,
  spkiDerToUncompressedPoint,
  uncompressedPointToSpkiBase64,
  uncompressedPointToSpkiDer,
  uncompressedPointToXY,
  xyToUncompressedPoint,
  zeroBytes,
  P256_SPKI_BASE64_LENGTH,
  P256_SPKI_DER_LENGTH,
} from './index';

const identityVector = vectors.identity_key_p256;
const x25519Vector = vectors.x25519_key;
const mlkemVector = vectors.mlkem768_key;

describe('hex', () => {
  it('round-trips every vector value', () => {
    for (const value of [
      vectors.seed_and_user_address.seed_hex,
      identityVector.private_key_hex,
      identityVector.public_key_uncompressed_hex,
      mlkemVector.public_key_hex,
    ]) {
      expect(bytesToHex(hexToBytes(value))).toBe(value);
    }
  });

  it('emits lowercase and accepts uppercase input', () => {
    const upper = identityVector.private_key_hex.toUpperCase();
    expect(bytesToHex(hexToBytes(upper))).toBe(identityVector.private_key_hex);
  });

  it('rejects odd-length and non-hex input', () => {
    expect(() => hexToBytes('abc')).toThrow(/even length/);
    expect(() => hexToBytes('zz')).toThrow(/non-hex/);
  });
});

describe('base64', () => {
  it('round-trips the vector encodings of both encryption public keys', () => {
    expect(bytesToBase64(hexToBytes(x25519Vector.public_key_hex))).toBe(
      x25519Vector.public_key_base64,
    );
    expect(bytesToBase64(hexToBytes(mlkemVector.public_key_hex))).toBe(
      mlkemVector.public_key_base64,
    );
    expect(bytesToHex(base64ToBytes(x25519Vector.public_key_base64))).toBe(
      x25519Vector.public_key_hex,
    );
    expect(bytesToHex(base64ToBytes(mlkemVector.public_key_base64))).toBe(
      mlkemVector.public_key_hex,
    );
  });

  it('produces the documented wire lengths', () => {
    expect(x25519Vector.public_key_base64).toHaveLength(44);
    expect(mlkemVector.public_key_base64).toHaveLength(1580);
  });

  it('round-trips arbitrary byte values including 0x00 and 0xff', () => {
    const bytes = new Uint8Array(256).map((_, index) => index);
    expect(bytesToHex(base64ToBytes(bytesToBase64(bytes)))).toBe(bytesToHex(bytes));
  });
});

describe('the three encodings of one P-256 public key', () => {
  const uncompressed = hexToBytes(identityVector.public_key_uncompressed_hex);

  it('encodes SPKI DER as base64 at exactly 124 characters', () => {
    const der = uncompressedPointToSpkiDer(uncompressed);
    expect(der).toHaveLength(P256_SPKI_DER_LENGTH);
    const base64 = uncompressedPointToSpkiBase64(uncompressed);
    expect(base64).toBe(identityVector.public_key_spki_base64);
    expect(base64).toHaveLength(P256_SPKI_BASE64_LENGTH);
  });

  it('recovers the uncompressed point from SPKI in both forms', () => {
    expect(
      bytesToHex(spkiDerToUncompressedPoint(uncompressedPointToSpkiDer(uncompressed))),
    ).toBe(identityVector.public_key_uncompressed_hex);
    expect(
      bytesToHex(spkiBase64ToUncompressedPoint(identityVector.public_key_spki_base64)),
    ).toBe(identityVector.public_key_uncompressed_hex);
  });

  it('splits into the on-chain raw (X, Y) pair', () => {
    const { x, y } = uncompressedPointToXY(uncompressed);
    expect(bytesToHex(x)).toBe(identityVector.onchain_pubkey_x_hex);
    expect(bytesToHex(y)).toBe(identityVector.onchain_pubkey_y_hex);
    expect(x).toHaveLength(32);
    expect(y).toHaveLength(32);
  });

  it('rebuilds the uncompressed point from (X, Y)', () => {
    const x = hexToBytes(identityVector.onchain_pubkey_x_hex);
    const y = hexToBytes(identityVector.onchain_pubkey_y_hex);
    const rebuilt = xyToUncompressedPoint(x, y);
    expect(rebuilt[0]).toBe(0x04);
    expect(bytesToHex(rebuilt)).toBe(identityVector.public_key_uncompressed_hex);
  });

  it('rejects malformed points and foreign SPKI headers', () => {
    expect(() => uncompressedPointToSpkiDer(uncompressed.slice(0, 64))).toThrow(/65 bytes/);

    const compressedTag = uncompressed.slice();
    compressedTag[0] = 0x02;
    expect(() => uncompressedPointToSpkiDer(compressedTag)).toThrow(/0x04/);

    const wrongHeader = uncompressedPointToSpkiDer(uncompressed);
    wrongHeader[8] = 0x00;
    expect(() => spkiDerToUncompressedPoint(wrongHeader)).toThrow(/unexpected SPKI header/);

    expect(() => spkiDerToUncompressedPoint(new Uint8Array(90))).toThrow(/91 bytes/);
    expect(() => xyToUncompressedPoint(new Uint8Array(31), new Uint8Array(32))).toThrow(
      /32 bytes each/,
    );
  });
});

describe('byte helpers', () => {
  it('concatenates in order', () => {
    expect(
      bytesToHex(concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array())),
    ).toBe('010203');
  });

  it('compares by content and length', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('zeroes key material in place and tolerates undefined', () => {
    const secret = hexToBytes(identityVector.private_key_hex);
    zeroBytes(secret, undefined);
    expect(bytesToHex(secret)).toBe('00'.repeat(32));
  });
});
