import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { base64ToBytes, bytesToBase64, concatBytes, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import {
  deviceRecipientSlot,
  pqxdhUnwrap,
  pqxdhWrap,
  type RecipientKeys,
  type X25519Secret,
} from '@/lib/pqxdh';
import { openBlob, openBytes, sealBlob, sealBytes } from '@/lib/sealed';

export const SCOPE_KEK_BYTES = 32;
export const SHARE_SUBKEY_BYTES = 32;
export const SHARE_SUBKEY_INFO_PREFIX = 'Cryple-Share-v1|';
export const DEVICE_KEYRING_USAGE = 'device-keyring' as const;

const X25519_PRIVATE_BYTES = 32;
const MLKEM_SEED_BYTES = 64;

export class KeyringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyringError';
  }
}

export function generateScopeKek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SCOPE_KEK_BYTES));
}

export async function wrapKekForRoot(
  rootWrapKey: Uint8Array,
  kek: Uint8Array,
  iv?: Uint8Array,
): Promise<string> {
  return bytesToBase64(await sealBytes(kek, rootWrapKey, iv));
}

export async function openRootWrap(rootWrapKey: Uint8Array, wrapped: string): Promise<Uint8Array> {
  return assertKek(await openBlob(wrapped, rootWrapKey));
}

export interface DeviceRecipient {
  deviceId: string;
  x25519PublicKey: string;
  mlkemPublicKey: string;
}

export function deviceRecipientKeys(device: DeviceRecipient): RecipientKeys {
  return {
    x25519PublicKey: base64ToBytes(device.x25519PublicKey),
    mlkemPublicKey: base64ToBytes(device.mlkemPublicKey),
  };
}

export async function wrapKekForDevice(
  kek: Uint8Array,
  userAddress: string,
  device: DeviceRecipient,
): Promise<string> {
  return pqxdhWrap(kek, deviceRecipientKeys(device), {
    usage: DEVICE_KEYRING_USAGE,
    senderUserAddress: userAddress,
    recipientUserAddress: deviceRecipientSlot(userAddress, device.deviceId),
  });
}

export interface DeviceSecrets {
  deviceId: string;
  x25519: X25519Secret;
  mlkemSecretKey: Uint8Array;
}

export async function openDeviceWrap(
  wrapped: string,
  userAddress: string,
  device: DeviceSecrets,
): Promise<Uint8Array> {
  const kek = await pqxdhUnwrap(
    wrapped,
    { x25519PrivateKey: device.x25519, mlkemSecretKey: device.mlkemSecretKey },
    {
      usage: DEVICE_KEYRING_USAGE,
      senderUserAddress: userAddress,
      recipientUserAddress: deviceRecipientSlot(userAddress, device.deviceId),
    },
  );
  return assertKek(kek);
}

function assertKek(kek: Uint8Array): Uint8Array {
  if (kek.length !== SCOPE_KEK_BYTES) {
    zeroBytes(kek);
    throw new KeyringError(`a scope KEK is ${SCOPE_KEK_BYTES} bytes`);
  }
  return kek;
}

export interface SharingKeyPair {
  x25519PrivateKey: Uint8Array;
  x25519PublicKey: Uint8Array;
  mlkemSeed: Uint8Array;
  mlkemSecretKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
}

export function sharingKeysFromMaterial(
  x25519PrivateKey: Uint8Array,
  mlkemSeed: Uint8Array,
): SharingKeyPair {
  if (x25519PrivateKey.length !== X25519_PRIVATE_BYTES || mlkemSeed.length !== MLKEM_SEED_BYTES) {
    throw new KeyringError('sharing material is an X25519 key and a 64-byte ML-KEM seed');
  }
  const { secretKey, publicKey } = ml_kem768.keygen(mlkemSeed);
  return {
    x25519PrivateKey,
    x25519PublicKey: x25519.getPublicKey(x25519PrivateKey),
    mlkemSeed,
    mlkemSecretKey: secretKey,
    mlkemPublicKey: publicKey,
  };
}

export function generateSharingKeys(): SharingKeyPair {
  return sharingKeysFromMaterial(
    x25519.utils.randomSecretKey(),
    crypto.getRandomValues(new Uint8Array(MLKEM_SEED_BYTES)),
  );
}

export function zeroSharingKeys(keys: SharingKeyPair | undefined): void {
  if (keys !== undefined) {
    zeroBytes(keys.x25519PrivateKey, keys.mlkemSeed, keys.mlkemSecretKey);
  }
}

export async function sealSharingMaterial(
  sharingKek: Uint8Array,
  keys: SharingKeyPair,
): Promise<string> {
  const material = concatBytes(keys.x25519PrivateKey, keys.mlkemSeed);
  try {
    return bytesToBase64(await sealBytes(material, sharingKek));
  } finally {
    zeroBytes(material);
  }
}

export async function openSharingMaterial(
  sharingKek: Uint8Array,
  sealed: string,
): Promise<SharingKeyPair> {
  const material = await openBytes(base64ToBytes(sealed), sharingKek);
  try {
    if (material.length !== X25519_PRIVATE_BYTES + MLKEM_SEED_BYTES) {
      throw new KeyringError('sharing material has the wrong length');
    }
    return sharingKeysFromMaterial(
      material.slice(0, X25519_PRIVATE_BYTES),
      material.slice(X25519_PRIVATE_BYTES),
    );
  } finally {
    zeroBytes(material);
  }
}

export async function deriveShareSubkey(
  connectionKey: Uint8Array,
  scope: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', connectionKey, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: utf8ToBytes(`${SHARE_SUBKEY_INFO_PREFIX}${scope}`),
    },
    key,
    SHARE_SUBKEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function sealUnderKek(kek: Uint8Array, payload: Uint8Array): Promise<string> {
  return sealBlob(payload, kek);
}

export async function openUnderKek(kek: Uint8Array, sealed: string): Promise<Uint8Array> {
  return openBlob(sealed, kek);
}
