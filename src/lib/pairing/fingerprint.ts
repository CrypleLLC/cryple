import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@/lib/encoding';

export const PAIRING_LABEL = 'Cryple-Pairing-v1';
export const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;

export interface PairingParties {
  code: string;
  userAddress: string;
  rootPublicKey: string;
  deviceId: string;
  signingPublicKey: string;
  x25519PublicKey: string;
  mlkemPublicKey: string;
}

export class MalformedPairingCodeError extends Error {
  constructor() {
    super('a pairing code is 8 characters, letters and digits');
    this.name = 'MalformedPairingCodeError';
  }
}

export function normalisePairingCode(typed: string): string {
  let normalised = '';
  for (const character of typed.toUpperCase()) {
    if (character === '-' || character === ' ') {
      continue;
    }
    const mapped = character === 'I' || character === 'L' ? '1' : character === 'O' ? '0' : character;
    if (!PAIRING_CODE_ALPHABET.includes(mapped)) {
      throw new MalformedPairingCodeError();
    }
    normalised += mapped;
  }
  if (normalised.length !== PAIRING_CODE_LENGTH) {
    throw new MalformedPairingCodeError();
  }
  return normalised;
}

export function formatPairingCode(code: string): string {
  const normalised = normalisePairingCode(code);
  return `${normalised.slice(0, 4)}-${normalised.slice(4)}`;
}

export function pairingFingerprint(parties: PairingParties): string {
  const input = [
    PAIRING_LABEL,
    normalisePairingCode(parties.code),
    parties.userAddress,
    parties.rootPublicKey,
    parties.deviceId,
    parties.signingPublicKey,
    parties.x25519PublicKey,
    parties.mlkemPublicKey,
  ].join('|');
  const digest = sha256(utf8ToBytes(input));
  const number = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false) % 1_000_000;
  return number.toString().padStart(6, '0');
}

export function displayFingerprint(fingerprint: string): string {
  return `${fingerprint.slice(0, 3)} ${fingerprint.slice(3)}`;
}
