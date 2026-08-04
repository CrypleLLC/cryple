import { p256 } from '@noble/curves/nist.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import {
  bytesToBase64,
  bytesToHex,
  uncompressedPointToSpkiBase64,
  utf8ToBytes,
  zeroBytes,
} from '@/lib/encoding';
import { deriveHardenedPath } from './slip10';
import { mnemonicToSeed } from './mnemonic';

export const IDENTITY_PATH = [9027, 0, 0] as const;
export const X25519_HKDF_INFO = 'Cryple-Key-v1|x25519';
export const MLKEM768_HKDF_INFO = 'Cryple-Key-v1|mlkem768';

const X25519_KEY_LENGTH = 32;
const MLKEM768_SEED_LENGTH = 64;

export interface IdentityKey {
  privateKey: Uint8Array;
  chainCode: Uint8Array;
  publicKeyUncompressed: Uint8Array;
  publicKeySpkiBase64: string;
}

export interface X25519Key {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyBase64: string;
}

export interface MlKem768Key {
  seed: Uint8Array;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyBase64: string;
}

export interface CrypleKeyTree {
  seed: Uint8Array;
  userAddress: string;
  identity: IdentityKey;
  x25519: X25519Key;
  mlkem768: MlKem768Key;
}

async function hkdfSha512(
  ikm: Uint8Array,
  info: string,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-512',
      salt: new Uint8Array(0),
      info: utf8ToBytes(info),
    },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function deriveUserAddress(seed: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', seed);
  return bytesToHex(new Uint8Array(digest));
}

export async function deriveIdentityKey(seed: Uint8Array): Promise<IdentityKey> {
  const node = await deriveHardenedPath(seed, IDENTITY_PATH);
  const publicKeyUncompressed = p256.getPublicKey(node.privateKey, false);
  return {
    privateKey: node.privateKey,
    chainCode: node.chainCode,
    publicKeyUncompressed,
    publicKeySpkiBase64: uncompressedPointToSpkiBase64(publicKeyUncompressed),
  };
}

export async function deriveX25519Key(seed: Uint8Array): Promise<X25519Key> {
  const privateKey = await hkdfSha512(seed, X25519_HKDF_INFO, X25519_KEY_LENGTH);
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyBase64: bytesToBase64(publicKey),
  };
}

export async function deriveMlKem768Key(seed: Uint8Array): Promise<MlKem768Key> {
  const kemSeed = await hkdfSha512(seed, MLKEM768_HKDF_INFO, MLKEM768_SEED_LENGTH);
  const { secretKey, publicKey } = ml_kem768.keygen(kemSeed);
  return {
    seed: kemSeed,
    secretKey,
    publicKey,
    publicKeyBase64: bytesToBase64(publicKey),
  };
}

export async function deriveKeyTreeFromSeed(seed: Uint8Array): Promise<CrypleKeyTree> {
  const [userAddress, identity, x25519Key, mlkem768] = await Promise.all([
    deriveUserAddress(seed),
    deriveIdentityKey(seed),
    deriveX25519Key(seed),
    deriveMlKem768Key(seed),
  ]);

  return { seed, userAddress, identity, x25519: x25519Key, mlkem768 };
}

export async function deriveKeyTree(
  mnemonic: string,
  passphrase = '',
): Promise<CrypleKeyTree> {
  return deriveKeyTreeFromSeed(await mnemonicToSeed(mnemonic, passphrase));
}

export function zeroKeyTree(tree: CrypleKeyTree): void {
  zeroBytes(
    tree.seed,
    tree.identity.privateKey,
    tree.identity.chainCode,
    tree.x25519.privateKey,
    tree.mlkem768.seed,
    tree.mlkem768.secretKey,
  );
}

export * from './mnemonic';
export * from './slip10';
