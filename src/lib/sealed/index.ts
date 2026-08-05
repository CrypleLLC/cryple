import { base64ToBytes, bytesToBase64, concatBytes, zeroBytes } from '@/lib/encoding';

export const SEALED_VERSION = 0x01;
export const SEALED_IV_LENGTH = 12;
export const SEALED_TAG_BITS = 128;

const MIN_SEALED_LENGTH = 1 + SEALED_IV_LENGTH + SEALED_TAG_BITS / 8;

export class UnsupportedSealedVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`unsupported sealed blob version byte 0x${version.toString(16).padStart(2, '0')}`);
    this.name = 'UnsupportedSealedVersionError';
    this.version = version;
  }
}

export class MalformedSealedBlobError extends Error {
  constructor(message: string) {
    super(`malformed sealed blob: ${message}`);
    this.name = 'MalformedSealedBlobError';
  }
}

async function importKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, [usage]);
}

export async function sealBlob(plaintext: Uint8Array, key: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(SEALED_IV_LENGTH));
  const aes = await importKey(key, 'encrypt');

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: SEALED_TAG_BITS },
      aes,
      plaintext,
    ),
  );

  return bytesToBase64(concatBytes(new Uint8Array([SEALED_VERSION]), iv, sealed));
}

export async function openBlob(blobBase64: string, key: Uint8Array): Promise<Uint8Array> {
  const blob = base64ToBytes(blobBase64);

  if (blob.length < MIN_SEALED_LENGTH) {
    throw new MalformedSealedBlobError(
      `${blob.length} bytes, shorter than the ${MIN_SEALED_LENGTH}-byte minimum`,
    );
  }
  if (blob[0] !== SEALED_VERSION) {
    throw new UnsupportedSealedVersionError(blob[0]);
  }

  const iv = blob.subarray(1, 1 + SEALED_IV_LENGTH);
  const sealed = blob.subarray(1 + SEALED_IV_LENGTH);
  const aes = await importKey(key, 'decrypt');

  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: SEALED_TAG_BITS },
      aes,
      sealed,
    ),
  );
}

export async function sealText(plaintext: string, key: Uint8Array): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext);
  try {
    return await sealBlob(bytes, key);
  } finally {
    zeroBytes(bytes);
  }
}

export async function openText(blobBase64: string, key: Uint8Array): Promise<string> {
  const bytes = await openBlob(blobBase64, key);
  try {
    return new TextDecoder().decode(bytes);
  } finally {
    zeroBytes(bytes);
  }
}
