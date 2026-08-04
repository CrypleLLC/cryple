import { base64ToBytes, bytesToBase64, concatBytes, zeroBytes } from '@/lib/encoding';

export const PAYLOAD_VERSION = 0x01;
export const PAYLOAD_IV_LENGTH = 12;
export const GCM_TAG_BITS = 128;

const MIN_BLOB_LENGTH = 1 + PAYLOAD_IV_LENGTH + GCM_TAG_BITS / 8;

export class UnsupportedPayloadVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`unsupported secret payload version byte 0x${version.toString(16).padStart(2, '0')}`);
    this.name = 'UnsupportedPayloadVersionError';
    this.version = version;
  }
}

async function importDek(dek: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealPayload(plaintext: Uint8Array, dek: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(PAYLOAD_IV_LENGTH));
  const key = await importDek(dek);

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: GCM_TAG_BITS },
      key,
      plaintext,
    ),
  );

  return bytesToBase64(concatBytes(new Uint8Array([PAYLOAD_VERSION]), iv, sealed));
}

export async function openPayload(ciphertext: string, dek: Uint8Array): Promise<Uint8Array> {
  const blob = base64ToBytes(ciphertext);

  if (blob.length < MIN_BLOB_LENGTH) {
    throw new Error(
      `secret payload is ${blob.length} bytes, shorter than the ${MIN_BLOB_LENGTH}-byte minimum`,
    );
  }
  if (blob[0] !== PAYLOAD_VERSION) {
    throw new UnsupportedPayloadVersionError(blob[0]);
  }

  const iv = blob.subarray(1, 1 + PAYLOAD_IV_LENGTH);
  const sealed = blob.subarray(1 + PAYLOAD_IV_LENGTH);
  const key = await importDek(dek);

  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: GCM_TAG_BITS }, key, sealed),
  );
}

export async function sealText(plaintext: string, dek: Uint8Array): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext);
  try {
    return await sealPayload(bytes, dek);
  } finally {
    zeroBytes(bytes);
  }
}

export async function openText(ciphertext: string, dek: Uint8Array): Promise<string> {
  const bytes = await openPayload(ciphertext, dek);
  try {
    return new TextDecoder().decode(bytes);
  } finally {
    zeroBytes(bytes);
  }
}
