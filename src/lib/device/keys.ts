import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { bytesToBase64, concatBytes, zeroBytes } from '@/lib/encoding';
import type { DeviceKeysDeclaration } from '@/lib/chain';
import type { X25519Secret } from '@/lib/pqxdh';
import type { Scope } from '@/lib/scopes';
import { cryptoKeySigner, type Signer } from '@/lib/signing';

export const MLKEM_SEED_BYTES = 64;
export const X25519_PRIVATE_BYTES = 32;

export type DeviceX25519 =
  | { kind: 'webcrypto'; privateKey: CryptoKey }
  | { kind: 'raw'; privateKey: Uint8Array };

export interface DeviceKeys {
  deviceId: string;
  signingKey: CryptoKey;
  signingPublicKey: string;
  x25519: DeviceX25519;
  x25519PublicKey: Uint8Array;
  mlkemSeed: Uint8Array;
  mlkemSecretKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
}

export class DeviceMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceMaterialError';
  }
}

async function generateSigningKey(): Promise<{ privateKey: CryptoKey; spki: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { privateKey: pair.privateKey, spki: bytesToBase64(spki) };
}

export async function supportsWebCryptoX25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

async function generateX25519(
  preferWebCrypto: boolean,
): Promise<{ key: DeviceX25519; publicKey: Uint8Array }> {
  if (preferWebCrypto && (await supportsWebCryptoX25519())) {
    const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { key: { kind: 'webcrypto', privateKey: pair.privateKey }, publicKey };
  }
  const privateKey = x25519.utils.randomSecretKey();
  return { key: { kind: 'raw', privateKey }, publicKey: x25519.getPublicKey(privateKey) };
}

export async function generateDeviceKeys(
  options: { deviceId?: string; preferWebCryptoX25519?: boolean } = {},
): Promise<DeviceKeys> {
  const signing = await generateSigningKey();
  const exchange = await generateX25519(options.preferWebCryptoX25519 ?? true);
  const mlkemSeed = crypto.getRandomValues(new Uint8Array(MLKEM_SEED_BYTES));
  const { secretKey, publicKey } = ml_kem768.keygen(mlkemSeed);
  return {
    deviceId: options.deviceId ?? crypto.randomUUID(),
    signingKey: signing.privateKey,
    signingPublicKey: signing.spki,
    x25519: exchange.key,
    x25519PublicKey: exchange.publicKey,
    mlkemSeed,
    mlkemSecretKey: secretKey,
    mlkemPublicKey: publicKey,
  };
}

export function deviceDeclaration(keys: DeviceKeys, scopes: readonly Scope[]): DeviceKeysDeclaration {
  return {
    deviceId: keys.deviceId,
    signingPublicKey: keys.signingPublicKey,
    x25519PublicKey: bytesToBase64(keys.x25519PublicKey),
    mlkemPublicKey: bytesToBase64(keys.mlkemPublicKey),
    scopes,
  };
}

export function deviceSigner(keys: Pick<DeviceKeys, 'signingKey'>): Signer {
  return cryptoKeySigner(keys.signingKey);
}

export function x25519Agreement(key: DeviceX25519): X25519Secret {
  if (key.kind === 'raw') {
    return key.privateKey;
  }
  return {
    deriveSharedSecret: async (peerPublicKey) => {
      const peer = await crypto.subtle.importKey('raw', peerPublicKey, { name: 'X25519' }, false, []);
      return new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, key.privateKey, 256),
      );
    },
  };
}

export function sealableMaterial(keys: DeviceKeys): Uint8Array {
  return keys.x25519.kind === 'raw'
    ? concatBytes(keys.mlkemSeed, keys.x25519.privateKey)
    : keys.mlkemSeed.slice();
}

export interface OpenedMaterial {
  mlkemSeed: Uint8Array;
  x25519PrivateKey?: Uint8Array;
}

export function parseMaterial(material: Uint8Array): OpenedMaterial {
  if (material.length === MLKEM_SEED_BYTES) {
    return { mlkemSeed: material.slice() };
  }
  if (material.length === MLKEM_SEED_BYTES + X25519_PRIVATE_BYTES) {
    return {
      mlkemSeed: material.slice(0, MLKEM_SEED_BYTES),
      x25519PrivateKey: material.slice(MLKEM_SEED_BYTES),
    };
  }
  throw new DeviceMaterialError('the sealed device material has an unexpected length');
}

export function zeroDeviceKeys(keys: DeviceKeys | undefined): void {
  if (keys === undefined) {
    return;
  }
  zeroBytes(keys.mlkemSeed, keys.mlkemSecretKey);
  if (keys.x25519.kind === 'raw') {
    zeroBytes(keys.x25519.privateKey);
  }
}
