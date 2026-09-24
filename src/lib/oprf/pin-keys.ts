import { ed25519, ristretto255, ristretto255_hasher, ristretto255_oprf } from '@noble/curves/ed25519.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { base64ToBytes, bytesToBase64, concatBytes, utf8ToBytes, zeroBytes } from '@/lib/encoding';

export const OPRF_SUITE = 'ristretto255-SHA512';
export const OPRF_HASH_TO_GROUP_DST = 'HashToGroup-OPRFV1-\x00-ristretto255-SHA512';
export const OPRF_OUTPUT_BYTES = 64;
export const ELEMENT_BYTES = 32;
export const PIN_LEAF_PREFIX = 'Cryple-PIN-v1|';
export const DEVICE_CONFIRM_PREFIX = 'Cryple-PIN-v1|device-confirm|';
export const DEVICE_SALT_BYTES = 32;
export const ARGON2ID_PARAMETERS = { m: 65536, t: 3, p: 1, dkLen: 32 } as const;

export type PinLeafLabel = 'device-wrap' | 'device-confirm' | 'account-proof';

export class MalformedElementError extends Error {
  constructor() {
    super('the server returned an element that is not a valid ristretto255 encoding');
    this.name = 'MalformedElementError';
  }
}

export interface BlindedPin {
  input: Uint8Array;
  blind: Uint8Array;
  blindedElement: string;
}

function pinInput(pin: string): Uint8Array {
  return utf8ToBytes(pin);
}

export function blindPin(pin: string): BlindedPin {
  const input = pinInput(pin);
  const { blind, blinded } = ristretto255_oprf.oprf.blind(input);
  return { input, blind, blindedElement: bytesToBase64(blinded) };
}

export function blindPinWithScalar(pin: string, blind: Uint8Array): BlindedPin {
  return blindInputWithScalar(pinInput(pin), blind);
}

export function blindInputWithScalar(input: Uint8Array, blind: Uint8Array): BlindedPin {
  const point = ristretto255_hasher.hashToCurve(input, { DST: OPRF_HASH_TO_GROUP_DST });
  const scalar = ristretto255.Point.Fn.fromBytes(blind);
  return {
    input: input.slice(),
    blind: blind.slice(),
    blindedElement: bytesToBase64(point.multiply(scalar).toBytes()),
  };
}

export function finalizePin(blinded: BlindedPin, evaluatedElement: string): Uint8Array {
  let evaluated: Uint8Array;
  try {
    evaluated = base64ToBytes(evaluatedElement);
  } catch {
    throw new MalformedElementError();
  }
  if (evaluated.length !== ELEMENT_BYTES) {
    throw new MalformedElementError();
  }
  try {
    return ristretto255_oprf.oprf.finalize(blinded.input, blinded.blind, evaluated);
  } catch {
    throw new MalformedElementError();
  } finally {
    zeroBytes(blinded.blind, blinded.input);
  }
}

export async function stretchPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2idAsync(pinInput(pin), salt, { ...ARGON2ID_PARAMETERS });
}

export function pinIkm(oprfOutput: Uint8Array, argon: Uint8Array): Uint8Array {
  if (oprfOutput.length !== OPRF_OUTPUT_BYTES || argon.length !== ARGON2ID_PARAMETERS.dkLen) {
    throw new Error('the PIN key material is an OPRF output and an Argon2id output');
  }
  return concatBytes(oprfOutput, argon);
}

export async function pinLeaf(ikm: Uint8Array, label: PinLeafLabel): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8ToBytes(PIN_LEAF_PREFIX + label) },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export function ed25519PublicKey(seed: Uint8Array): string {
  return bytesToBase64(ed25519.getPublicKey(seed));
}

export function ed25519Sign(seed: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, seed);
}

export interface DevicePinKeys {
  wrapKey: Uint8Array;
  confirmSeed: Uint8Array;
  confirmPublicKey: string;
}

export async function deriveDevicePinKeys(
  oprfOutput: Uint8Array,
  pin: string,
  salt: Uint8Array,
): Promise<DevicePinKeys> {
  const argon = await stretchPin(pin, salt);
  const ikm = pinIkm(oprfOutput, argon);
  try {
    const wrapKey = await pinLeaf(ikm, 'device-wrap');
    const confirmSeed = await pinLeaf(ikm, 'device-confirm');
    return { wrapKey, confirmSeed, confirmPublicKey: ed25519PublicKey(confirmSeed) };
  } finally {
    zeroBytes(argon, ikm, oprfOutput);
  }
}

export function zeroDevicePinKeys(keys: DevicePinKeys | undefined): void {
  if (keys !== undefined) {
    zeroBytes(keys.wrapKey, keys.confirmSeed);
  }
}

export function deviceConfirmMessage(registrationId: string, attemptId: string): string {
  return `${DEVICE_CONFIRM_PREFIX}${registrationId}|${attemptId}`;
}

export function signDeviceConfirmation(
  confirmSeed: Uint8Array,
  registrationId: string,
  attemptId: string,
): string {
  return bytesToBase64(
    ed25519Sign(confirmSeed, utf8ToBytes(deviceConfirmMessage(registrationId, attemptId))),
  );
}

export interface AccountProofKey {
  seed: Uint8Array;
  publicKey: string;
}

export async function deriveAccountProofKey(
  oprfOutput: Uint8Array,
  pin: string,
  userAddress: string,
): Promise<AccountProofKey> {
  const argon = await stretchPin(pin, utf8ToBytes(userAddress));
  const ikm = pinIkm(oprfOutput, argon);
  try {
    const seed = await pinLeaf(ikm, 'account-proof');
    return { seed, publicKey: ed25519PublicKey(seed) };
  } finally {
    zeroBytes(argon, ikm, oprfOutput);
  }
}

export function proofSigner(key: AccountProofKey): (digest: Uint8Array) => Uint8Array {
  return (digest) => ed25519Sign(key.seed, digest);
}

export function generateDeviceSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEVICE_SALT_BYTES));
}
