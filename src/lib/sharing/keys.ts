import { bytesToBase64, base64ToBytes, bytesToHex } from '@/lib/encoding';
import { pqxdhWrap, pqxdhUnwrap, type RecipientKeys, type RecipientSecrets } from '@/lib/pqxdh';

export const SHARING_USAGE = 'item-share' as const;
export const CONNECTION_KEY_BYTES = 32;
export const WRAP_IV_BYTES = 12;
export const FINGERPRINT_GROUPS = 6;
export const FINGERPRINT_GROUP_SIZE = 4;

export class ConnectionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionKeyError';
  }
}

const USER_ADDRESS_PATTERN = /^[0-9a-f]{64}$/;

export class MalformedPartyAddressError extends ConnectionKeyError {
  constructor(role: 'sender' | 'recipient', value: unknown) {
    super(
      `the ${role} address is ${describeAddress(value)}, so the key exchange cannot be reproduced`,
    );
    this.name = 'MalformedPartyAddressError';
  }
}

function describeAddress(value: unknown): string {
  if (typeof value !== 'string') {
    return `missing (${typeof value})`;
  }

  return value === '' ? 'empty' : 'not 64 lowercase hex characters';
}

function assertParties(senderUserAddress: string, recipientUserAddress: string): void {
  if (!USER_ADDRESS_PATTERN.test(senderUserAddress)) {
    throw new MalformedPartyAddressError('sender', senderUserAddress);
  }

  if (!USER_ADDRESS_PATTERN.test(recipientUserAddress)) {
    throw new MalformedPartyAddressError('recipient', recipientUserAddress);
  }
}

export function createConnectionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(CONNECTION_KEY_BYTES));
}

export async function sealConnectionKey(
  connectionKey: Uint8Array,
  recipient: RecipientKeys,
  senderUserAddress: string,
  recipientUserAddress: string,
): Promise<string> {
  assertParties(senderUserAddress, recipientUserAddress);

  return pqxdhWrap(connectionKey, recipient, {
    usage: SHARING_USAGE,
    senderUserAddress,
    recipientUserAddress,
  });
}

export async function openConnectionKey(
  pqxdhBlob: string,
  secrets: RecipientSecrets,
  senderUserAddress: string,
  recipientUserAddress: string,
): Promise<Uint8Array> {
  assertParties(senderUserAddress, recipientUserAddress);

  const key = await pqxdhUnwrap(pqxdhBlob, secrets, {
    usage: SHARING_USAGE,
    senderUserAddress,
    recipientUserAddress,
  });

  if (key.length !== CONNECTION_KEY_BYTES) {
    throw new ConnectionKeyError(
      `connection key is ${key.length} bytes, expected ${CONNECTION_KEY_BYTES}`,
    );
  }

  return key;
}

export async function wrapUnderConnection(
  connectionKey: Uint8Array,
  payload: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', connectionKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));

  const blob = new Uint8Array(iv.length + sealed.length);
  blob.set(iv, 0);
  blob.set(sealed, iv.length);

  return bytesToBase64(blob);
}

export async function unwrapUnderConnection(
  connectionKey: Uint8Array,
  blobBase64: string,
): Promise<Uint8Array> {
  const blob = base64ToBytes(blobBase64);
  if (blob.length <= WRAP_IV_BYTES) {
    throw new ConnectionKeyError('wrapped payload is shorter than its IV');
  }

  const key = await crypto.subtle.importKey('raw', connectionKey, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.subarray(0, WRAP_IV_BYTES) },
    key,
    blob.subarray(WRAP_IV_BYTES),
  );

  return new Uint8Array(plaintext);
}

export function publishedRecipientKeys(record: {
  encryption_public_key_x25519: string;
  encryption_public_key_mlkem: string;
}): RecipientKeys {
  return {
    x25519PublicKey: base64ToBytes(record.encryption_public_key_x25519),
    mlkemPublicKey: base64ToBytes(record.encryption_public_key_mlkem),
  };
}

export async function rootFingerprint(rootPublicKeySpki: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', base64ToBytes(rootPublicKeySpki)),
  );
  const hex = bytesToHex(digest).toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < FINGERPRINT_GROUPS; i += 1) {
    groups.push(hex.slice(i * FINGERPRINT_GROUP_SIZE, (i + 1) * FINGERPRINT_GROUP_SIZE));
  }
  return groups.join('-');
}
