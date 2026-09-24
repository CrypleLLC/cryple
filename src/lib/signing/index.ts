import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToBase64, bytesToHex, utf8ToBytes } from '@/lib/encoding';
import {
  getActionSpec,
  normalizeActionArgs,
  type ActionLabel,
  type DeviceActionLabel,
  type RootActionLabel,
} from './actions';

export const CHALLENGE_BYTES = 32;
export const SIGNATURE_BYTES = 64;
export const FRESHNESS_WINDOW_SECONDS = 300;

export interface SignatureEnvelope {
  challenge: string;
  timestamp: number;
  signature: string;
}

export interface RootActionEnvelope extends SignatureEnvelope {
  pin_proof?: string;
}

export interface Signer {
  signBytes(message: Uint8Array): Promise<Uint8Array>;
}

export type PinProofSigner = (digest: Uint8Array) => Uint8Array | Promise<Uint8Array>;

export function rawKeySigner(privateKey: Uint8Array): Signer {
  return {
    signBytes: async (message) => p256.sign(message, privateKey, { format: 'compact' }),
  };
}

export function cryptoKeySigner(privateKey: CryptoKey): Signer {
  return {
    signBytes: async (message) =>
      new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, message),
      ),
  };
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

export function payloadDigest(payload: string): Uint8Array {
  return sha256(utf8ToBytes(payload));
}

export async function signPayload(payload: string, signer: Signer): Promise<string> {
  const signature = await signer.signBytes(utf8ToBytes(payload));
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
  let signature: Uint8Array;
  try {
    signature = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (signature.length !== SIGNATURE_BYTES) {
    return false;
  }
  try {
    return p256.verify(signature, utf8ToBytes(payload), publicKeyUncompressed, {
      format: 'compact',
      lowS: false,
    });
  } catch {
    return false;
  }
}

export async function signAuthEnvelope(signer: Signer): Promise<SignatureEnvelope> {
  const challenge = createChallenge();
  const timestamp = currentTimestamp();
  const signature = await signPayload(buildAuthPayload(challenge, timestamp), signer);
  return { challenge, timestamp, signature };
}

export async function signActionEnvelope(
  action: DeviceActionLabel,
  args: readonly (string | number)[],
  device: Signer,
): Promise<SignatureEnvelope> {
  if (getActionSpec(action).signer !== 'device') {
    throw new Error(`${action} is signed by the root, not by a device`);
  }
  const challenge = createChallenge();
  const timestamp = currentTimestamp();
  const payload = buildActionPayload(challenge, timestamp, action, args);
  return { challenge, timestamp, signature: await signPayload(payload, device) };
}

export async function signRootAction(
  action: RootActionLabel,
  args: readonly (string | number)[],
  root: Signer,
  pinProof?: PinProofSigner,
): Promise<RootActionEnvelope> {
  const spec = getActionSpec(action);
  if (spec.signer !== 'root') {
    throw new Error(`${action} is signed by a device, not by the root`);
  }
  if (pinProof !== undefined && !spec.pinProof) {
    throw new Error(`${action} never carries a PIN proof`);
  }

  const challenge = createChallenge();
  const timestamp = currentTimestamp();
  const payload = buildActionPayload(challenge, timestamp, action, args);
  const envelope: RootActionEnvelope = {
    challenge,
    timestamp,
    signature: await signPayload(payload, root),
  };

  if (pinProof !== undefined) {
    envelope.pin_proof = bytesToBase64(await pinProof(payloadDigest(payload)));
  }

  return envelope;
}

export * from './actions';
