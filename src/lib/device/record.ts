import { base64ToBytes, bytesToBase64 } from '@/lib/encoding';
import { openBytes, sealBytes } from '@/lib/sealed';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { parseScopeList, type Scope } from '@/lib/scopes';
import {
  DeviceMaterialError,
  parseMaterial,
  sealableMaterial,
  type DeviceKeys,
  type DeviceX25519,
} from './keys';

export interface DeviceRecord {
  device_id: string;
  registration_id: string;
  salt: string;
  sealed: string;
  user_address: string;
  root_public_key: string;
  scopes: string;
  signing_key: CryptoKey;
  signing_public_key: string;
  x25519_key?: CryptoKey;
  x25519_public_key: string;
  mlkem_public_key: string;
}

export interface DeviceIdentity {
  userAddress: string;
  rootPublicKey: string;
  scopes: readonly Scope[];
}

export async function sealDeviceRecord(options: {
  keys: DeviceKeys;
  identity: DeviceIdentity;
  registrationId: string;
  salt: Uint8Array;
  wrapKey: Uint8Array;
}): Promise<DeviceRecord> {
  const { keys, identity } = options;
  const material = sealableMaterial(keys);
  try {
    const sealed = await sealBytes(material, options.wrapKey);
    return {
      device_id: keys.deviceId,
      registration_id: options.registrationId,
      salt: bytesToBase64(options.salt),
      sealed: bytesToBase64(sealed),
      user_address: identity.userAddress,
      root_public_key: identity.rootPublicKey,
      scopes: identity.scopes.join(','),
      signing_key: keys.signingKey,
      signing_public_key: keys.signingPublicKey,
      x25519_key: keys.x25519.kind === 'webcrypto' ? keys.x25519.privateKey : undefined,
      x25519_public_key: bytesToBase64(keys.x25519PublicKey),
      mlkem_public_key: bytesToBase64(keys.mlkemPublicKey),
    };
  } finally {
    material.fill(0);
  }
}

export class WrongDevicePinError extends Error {
  constructor() {
    super('the device material did not open under this PIN');
    this.name = 'WrongDevicePinError';
  }
}

export async function openDeviceRecord(
  record: DeviceRecord,
  wrapKey: Uint8Array,
): Promise<DeviceKeys> {
  let material: Uint8Array;
  try {
    material = await openBytes(base64ToBytes(record.sealed), wrapKey);
  } catch {
    throw new WrongDevicePinError();
  }

  try {
    const opened = parseMaterial(material);
    let exchange: DeviceX25519;
    if (record.x25519_key !== undefined) {
      exchange = { kind: 'webcrypto', privateKey: record.x25519_key };
    } else if (opened.x25519PrivateKey !== undefined) {
      exchange = { kind: 'raw', privateKey: opened.x25519PrivateKey };
    } else {
      throw new DeviceMaterialError('the device record holds no X25519 key');
    }

    const x25519PublicKey = base64ToBytes(record.x25519_public_key);
    if (exchange.kind === 'raw') {
      const derived = bytesToBase64(x25519.getPublicKey(exchange.privateKey));
      if (derived !== record.x25519_public_key) {
        throw new DeviceMaterialError('the sealed X25519 key does not match the record');
      }
    }
    const { secretKey, publicKey } = ml_kem768.keygen(opened.mlkemSeed);
    if (bytesToBase64(publicKey) !== record.mlkem_public_key) {
      throw new DeviceMaterialError('the sealed ML-KEM seed does not match the record');
    }

    return {
      deviceId: record.device_id,
      signingKey: record.signing_key,
      signingPublicKey: record.signing_public_key,
      x25519: exchange,
      x25519PublicKey,
      mlkemSeed: opened.mlkemSeed,
      mlkemSecretKey: secretKey,
      mlkemPublicKey: publicKey,
    };
  } finally {
    material.fill(0);
  }
}

export function recordIdentity(record: DeviceRecord): DeviceIdentity {
  return {
    userAddress: record.user_address,
    rootPublicKey: record.root_public_key,
    scopes: parseScopeList(record.scopes),
  };
}

export function isDeviceRecord(value: unknown): value is DeviceRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<DeviceRecord>;
  return (
    typeof record.device_id === 'string' &&
    typeof record.registration_id === 'string' &&
    typeof record.salt === 'string' &&
    typeof record.sealed === 'string' &&
    typeof record.user_address === 'string' &&
    typeof record.root_public_key === 'string' &&
    typeof record.scopes === 'string' &&
    typeof record.signing_public_key === 'string' &&
    typeof record.x25519_public_key === 'string' &&
    typeof record.mlkem_public_key === 'string' &&
    typeof record.signing_key === 'object' &&
    record.signing_key !== null
  );
}
