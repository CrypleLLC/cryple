import { p256 } from '@noble/curves/nist.js';
import { bytesToNumberBE } from '@noble/curves/utils.js';
import { concatBytes, utf8ToBytes, zeroBytes } from '@/lib/encoding';

export const SLIP10_P256_CURVE_NAME = 'Nist256p1 seed';
export const HARDENED_OFFSET = 0x80000000;

const CURVE_ORDER = p256.Point.Fn.ORDER;
const KEY_LENGTH = 32;

export interface Slip10Node {
  privateKey: Uint8Array;
  chainCode: Uint8Array;
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, data));
}

function ser32(index: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, index, false);
  return out;
}

function isValidScalar(candidate: Uint8Array): boolean {
  const value = bytesToNumberBE(candidate);
  return value !== BigInt(0) && value < CURVE_ORDER;
}

export async function deriveMasterNode(seed: Uint8Array): Promise<Slip10Node> {
  let data = seed;
  for (;;) {
    const i = await hmacSha512(utf8ToBytes(SLIP10_P256_CURVE_NAME), data);
    const il = i.slice(0, KEY_LENGTH);
    const ir = i.slice(KEY_LENGTH);
    if (isValidScalar(il)) {
      return { privateKey: il, chainCode: ir };
    }
    zeroBytes(il, ir);
    data = i;
  }
}

export async function deriveHardenedChild(
  parent: Slip10Node,
  index: number,
): Promise<Slip10Node> {
  if (index < 0 || index >= HARDENED_OFFSET) {
    throw new Error(`child index out of range for hardened derivation: ${index}`);
  }

  const hardenedIndex = index + HARDENED_OFFSET;
  const parentScalar = bytesToNumberBE(parent.privateKey);

  let data = concatBytes(
    new Uint8Array([0x00]),
    parent.privateKey,
    ser32(hardenedIndex),
  );

  for (;;) {
    const i = await hmacSha512(parent.chainCode, data);
    const il = i.slice(0, KEY_LENGTH);
    const ir = i.slice(KEY_LENGTH);

    const ilValue = bytesToNumberBE(il);
    const childScalar = (ilValue + parentScalar) % CURVE_ORDER;

    if (ilValue < CURVE_ORDER && childScalar !== BigInt(0)) {
      const privateKey = new Uint8Array(KEY_LENGTH);
      let remaining = childScalar;
      for (let byte = KEY_LENGTH - 1; byte >= 0; byte--) {
        privateKey[byte] = Number(remaining & BigInt(0xff));
        remaining >>= BigInt(8);
      }
      zeroBytes(il);
      return { privateKey, chainCode: ir };
    }

    data = concatBytes(new Uint8Array([0x01]), ir, ser32(hardenedIndex));
    zeroBytes(il, ir);
  }
}

export async function deriveHardenedPath(
  seed: Uint8Array,
  path: readonly number[],
): Promise<Slip10Node> {
  let node = await deriveMasterNode(seed);
  for (const index of path) {
    const child = await deriveHardenedChild(node, index);
    zeroBytes(node.privateKey, node.chainCode);
    node = child;
  }
  return node;
}
