import { p256 } from '@noble/curves/nist.js';
import { bytesToBase64, bytesToHex, utf8ToBytes } from '@/lib/encoding';
import {
  getActionSpec,
  normalizeActionArgs,
  type ActionLabel,
} from './actions';

export const CHALLENGE_BYTES = 32;
export const SIGNATURE_BYTES = 64;
export const FRESHNESS_WINDOW_SECONDS = 300;

export interface SignatureEnvelope {
  challenge: string;
  timestamp: number;
  signature: string;
  password?: string;
}

export interface SigningIdentity {
  privateKey: Uint8Array;
  serverAuthToken?: string;
}

export function createChallenge(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES)));
}

export function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function buildAuthPayload(challenge: string, timestamp: number): string {
  return `${challenge}:${timestamp}`;
}

export function buildActionPayload(
  challenge: string,
  timestamp: number,
  action: ActionLabel,
  args: readonly (string | number)[],
): string {
  return [challenge, timestamp, action, ...normalizeActionArgs(action, args)].join(':');
}

export function signPayload(payload: string, privateKey: Uint8Array): string {
  const signature = p256.sign(utf8ToBytes(payload), privateKey, { format: 'compact' });
  if (signature.length !== SIGNATURE_BYTES) {
    throw new Error(
      `expected a ${SIGNATURE_BYTES}-byte IEEE P1363 signature, got ${signature.length}`,
    );
  }
  return bytesToBase64(signature);
}

export function verifyPayload(
  payload: string,
  signatureBase64: string,
  publicKeyUncompressed: Uint8Array,
): boolean {
  const signature = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
  if (signature.length !== SIGNATURE_BYTES) {
    return false;
  }
  return p256.verify(signature, utf8ToBytes(payload), publicKeyUncompressed, {
    format: 'compact',
  });
}

export function signAuthEnvelope(
  identity: SigningIdentity,
  options: { paranoid: boolean },
): SignatureEnvelope {
  const challenge = createChallenge();
  const timestamp = currentTimestamp();
  const signature = signPayload(buildAuthPayload(challenge, timestamp), identity.privateKey);

  const envelope: SignatureEnvelope = { challenge, timestamp, signature };

  if (options.paranoid) {
    if (identity.serverAuthToken === undefined) {
      throw new Error('a Paranoid Mode account must send the Server_Auth_Token');
    }
    envelope.password = identity.serverAuthToken;
  }

  return envelope;
}

export function signActionEnvelope(
  action: ActionLabel,
  args: readonly (string | number)[],
  identity: SigningIdentity,
  options: { paranoid: boolean },
): SignatureEnvelope {
  const spec = getActionSpec(action);
  const challenge = createChallenge();
  const timestamp = currentTimestamp();
  const payload = buildActionPayload(challenge, timestamp, action, args);
  const signature = signPayload(payload, identity.privateKey);

  const envelope: SignatureEnvelope = { challenge, timestamp, signature };

  if (spec.secondFactor && options.paranoid) {
    if (identity.serverAuthToken === undefined) {
      throw new Error(
        `${action} requires the second factor on a Paranoid Mode account, but no Server_Auth_Token was provided`,
      );
    }
    envelope.password = identity.serverAuthToken;
  }

  return envelope;
}

export * from './actions';
