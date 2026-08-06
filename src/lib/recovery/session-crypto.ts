import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { base64ToBytes, bytesToBase64, zeroBytes } from '@/lib/encoding';
import { pqxdhUnwrap, pqxdhWrap } from '@/lib/pqxdh';

export const EPHEMERAL_X25519_PUBLIC_LENGTH = 32;
export const EPHEMERAL_MLKEM_PUBLIC_LENGTH = 1184;

export interface EphemeralSessionKeys {
  x25519PublicKey: Uint8Array;
  x25519PrivateKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
  mlkemSecretKey: Uint8Array;
}

export interface EphemeralPublicFields {
  ephemeral_x25519_public: string;
  ephemeral_mlkem_public: string;
}

export interface SessionRecipientKeys {
  ephemeral_x25519_public: string;
  ephemeral_mlkem_public: string;
}

export class MalformedEphemeralKeyError extends Error {
  constructor(field: string, expected: number, actual: number) {
    super(`${field} must decode to ${expected} bytes, got ${actual}`);
    this.name = 'MalformedEphemeralKeyError';
  }
}

/**
 * Both address slots of the PQXDH info string carry the session_id for this
 * usage — the recovering device can derive neither party's user_address.
 * See ../api-general/.docs/crypto/pqxdh.md § Exception.
 */
function sessionContext(sessionId: string) {
  return {
    usage: 'recovery-session' as const,
    senderUserAddress: sessionId,
    recipientUserAddress: sessionId,
  };
}

export function generateEphemeralKeys(): EphemeralSessionKeys {
  const classical = x25519.keygen();
  const quantum = ml_kem768.keygen();

  return {
    x25519PublicKey: classical.publicKey,
    x25519PrivateKey: classical.secretKey,
    mlkemPublicKey: quantum.publicKey,
    mlkemSecretKey: quantum.secretKey,
  };
}

export function ephemeralPublicFields(keys: EphemeralSessionKeys): EphemeralPublicFields {
  return {
    ephemeral_x25519_public: bytesToBase64(keys.x25519PublicKey),
    ephemeral_mlkem_public: bytesToBase64(keys.mlkemPublicKey),
  };
}

export function parseSessionRecipient(fields: SessionRecipientKeys): {
  x25519PublicKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
} {
  const x25519PublicKey = base64ToBytes(fields.ephemeral_x25519_public);
  if (x25519PublicKey.length !== EPHEMERAL_X25519_PUBLIC_LENGTH) {
    throw new MalformedEphemeralKeyError(
      'ephemeral_x25519_public',
      EPHEMERAL_X25519_PUBLIC_LENGTH,
      x25519PublicKey.length,
    );
  }

  const mlkemPublicKey = base64ToBytes(fields.ephemeral_mlkem_public);
  if (mlkemPublicKey.length !== EPHEMERAL_MLKEM_PUBLIC_LENGTH) {
    throw new MalformedEphemeralKeyError(
      'ephemeral_mlkem_public',
      EPHEMERAL_MLKEM_PUBLIC_LENGTH,
      mlkemPublicKey.length,
    );
  }

  return { x25519PublicKey, mlkemPublicKey };
}

/** Guardian device: re-wrap a plaintext share to the session's ephemeral keys. */
export async function rewrapToSession(
  share: Uint8Array,
  recipient: SessionRecipientKeys,
  sessionId: string,
): Promise<string> {
  return pqxdhWrap(share, parseSessionRecipient(recipient), sessionContext(sessionId));
}

/** Recovering device: open a share a guardian submitted. */
export async function unwrapSessionShare(
  reEncryptedShare: string,
  keys: EphemeralSessionKeys,
  sessionId: string,
): Promise<Uint8Array> {
  return pqxdhUnwrap(
    reEncryptedShare,
    { x25519PrivateKey: keys.x25519PrivateKey, mlkemSecretKey: keys.mlkemSecretKey },
    sessionContext(sessionId),
  );
}

export function disposeEphemeralKeys(keys: EphemeralSessionKeys): void {
  zeroBytes(keys.x25519PrivateKey, keys.mlkemSecretKey);
}
