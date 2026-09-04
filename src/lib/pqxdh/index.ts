import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  utf8ToBytes,
  zeroBytes,
} from '@/lib/encoding';

export const PQXDH_VERSION = 0x01;
export const KEM_CIPHERTEXT_LENGTH = 1088;
export const EPHEMERAL_PUBLIC_LENGTH = 32;
export const IV_LENGTH = 12;
export const GCM_TAG_LENGTH = 16;
export const SESSION_KEY_LENGTH = 32;

export const PQXDH_INFO_PREFIX = 'Cryple-PQXDH-v1|';

const IKM_PREFIX_BYTE = 0xff;
const IKM_PREFIX_LENGTH = 32;
const HKDF_SALT_LENGTH = 32;

const HEADER_LENGTH = 1 + KEM_CIPHERTEXT_LENGTH + EPHEMERAL_PUBLIC_LENGTH + IV_LENGTH;
const MIN_BLOB_LENGTH = HEADER_LENGTH + GCM_TAG_LENGTH;

export const PQXDH_USAGES = ['recovery-share', 'recovery-session'] as const;
export type PqxdhUsage = (typeof PQXDH_USAGES)[number];

export class UnsupportedPqxdhVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`unsupported PQXDH version byte 0x${version.toString(16).padStart(2, '0')}`);
    this.name = 'UnsupportedPqxdhVersionError';
    this.version = version;
  }
}

export class MalformedPqxdhBlobError extends Error {
  constructor(message: string) {
    super(`malformed PQXDH blob: ${message}`);
    this.name = 'MalformedPqxdhBlobError';
  }
}

export interface RecipientKeys {
  x25519PublicKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
}

export interface RecipientSecrets {
  x25519PrivateKey: Uint8Array;
  mlkemSecretKey: Uint8Array;
}

export interface PqxdhContext {
  usage: PqxdhUsage;
  senderUserAddress: string;
  recipientUserAddress: string;
}

export function buildInfo(context: PqxdhContext): string {
  return (
    PQXDH_INFO_PREFIX +
    `${context.usage}|${context.senderUserAddress}|${context.recipientUserAddress}`
  );
}

export async function deriveSessionKey(
  ecdhSecret: Uint8Array,
  kemSecret: Uint8Array,
  context: PqxdhContext,
): Promise<Uint8Array> {
  const prefix = new Uint8Array(IKM_PREFIX_LENGTH).fill(IKM_PREFIX_BYTE);
  const ikm = concatBytes(prefix, ecdhSecret, kemSecret);

  try {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(HKDF_SALT_LENGTH),
        info: utf8ToBytes(buildInfo(context)),
      },
      key,
      SESSION_KEY_LENGTH * 8,
    );
    return new Uint8Array(bits);
  } finally {
    zeroBytes(ikm);
  }
}

export interface ParsedBlob {
  version: number;
  kemCiphertext: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  iv: Uint8Array;
  sealed: Uint8Array;
}

export function parseBlob(blobBase64: string): ParsedBlob {
  const blob = base64ToBytes(blobBase64);

  if (blob.length < MIN_BLOB_LENGTH) {
    throw new MalformedPqxdhBlobError(
      `${blob.length} bytes, shorter than the ${MIN_BLOB_LENGTH}-byte minimum`,
    );
  }
  if (blob[0] !== PQXDH_VERSION) {
    throw new UnsupportedPqxdhVersionError(blob[0]);
  }

  let offset = 1;
  const kemCiphertext = blob.subarray(offset, (offset += KEM_CIPHERTEXT_LENGTH));
  const ephemeralPublicKey = blob.subarray(offset, (offset += EPHEMERAL_PUBLIC_LENGTH));
  const iv = blob.subarray(offset, (offset += IV_LENGTH));
  const sealed = blob.subarray(offset);

  return { version: blob[0], kemCiphertext, ephemeralPublicKey, iv, sealed };
}

export async function pqxdhWrap(
  payload: Uint8Array,
  recipient: RecipientKeys,
  context: PqxdhContext,
): Promise<string> {
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  let ecdhSecret: Uint8Array | undefined;
  let kemSecret: Uint8Array | undefined;
  let sessionKey: Uint8Array | undefined;

  try {
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    ecdhSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipient.x25519PublicKey);

    const encapsulated = ml_kem768.encapsulate(recipient.mlkemPublicKey);
    kemSecret = encapsulated.sharedSecret;

    sessionKey = await deriveSessionKey(ecdhSecret, kemSecret, context);
    const key = await crypto.subtle.importKey('raw', sessionKey, 'AES-GCM', false, ['encrypt']);

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload),
    );

    return bytesToBase64(
      concatBytes(
        new Uint8Array([PQXDH_VERSION]),
        encapsulated.cipherText,
        ephemeralPublicKey,
        iv,
        sealed,
      ),
    );
  } finally {
    zeroBytes(ephemeralPrivateKey, ecdhSecret, kemSecret, sessionKey);
  }
}

export async function pqxdhUnwrap(
  blobBase64: string,
  secrets: RecipientSecrets,
  context: PqxdhContext,
): Promise<Uint8Array> {
  const { kemCiphertext, ephemeralPublicKey, iv, sealed } = parseBlob(blobBase64);

  let ecdhSecret: Uint8Array | undefined;
  let kemSecret: Uint8Array | undefined;
  let sessionKey: Uint8Array | undefined;

  try {
    ecdhSecret = x25519.getSharedSecret(secrets.x25519PrivateKey, ephemeralPublicKey);
    kemSecret = ml_kem768.decapsulate(kemCiphertext, secrets.mlkemSecretKey);

    sessionKey = await deriveSessionKey(ecdhSecret, kemSecret, context);
    const key = await crypto.subtle.importKey('raw', sessionKey, 'AES-GCM', false, ['decrypt']);

    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed),
    );
  } finally {
    zeroBytes(ecdhSecret, kemSecret, sessionKey);
  }
}
