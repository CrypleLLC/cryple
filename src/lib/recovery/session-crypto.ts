export interface EphemeralSessionKeys {
  publicKeyField: string;
  x25519PrivateKey: Uint8Array;
  mlkemSecretKey: Uint8Array;
}

export interface SessionShareContext {
  senderUserAddress: string;
  recipientUserAddress: string;
}

export interface RecoverySessionCrypto {
  generateEphemeralKeys(): Promise<EphemeralSessionKeys>;
  unwrapShare(
    reEncryptedShare: string,
    keys: EphemeralSessionKeys,
    context: SessionShareContext,
  ): Promise<Uint8Array>;
}

export class RecoverySessionCryptoUnspecifiedError extends Error {
  constructor(operation: string) {
    super(
      `${operation} is unavailable: the recovery-session PQXDH binding is unspecified. ` +
        'Two things are missing from the wire contract — (1) POST /recovery/request carries a ' +
        'single opaque `ephemeral_public_key`, but PQXDH needs both an X25519 (32 B) and an ' +
        'ML-KEM-768 (1184 B) recipient key, and no encoding is defined; (2) the recovering ' +
        'device cannot build the PQXDH info string, because GET /recovery/session/{id} returns ' +
        'only {re_encrypted_share, submitted_at} — it learns neither the submitting guardian\'s ' +
        'user_address (the sender) nor its own account\'s user_address (the recipient), and ' +
        'there is no username -> address lookup. Do not invent either here: the server stores ' +
        'the field unvalidated, so a divergent choice fails silently. See ' +
        'proposals/opaque-blob-layouts.md.',
    );
    this.name = 'RecoverySessionCryptoUnspecifiedError';
  }
}

export const unspecifiedRecoverySessionCrypto: RecoverySessionCrypto = {
  generateEphemeralKeys() {
    return Promise.reject(new RecoverySessionCryptoUnspecifiedError('generateEphemeralKeys'));
  },
  unwrapShare() {
    return Promise.reject(new RecoverySessionCryptoUnspecifiedError('unwrapShare'));
  },
};
