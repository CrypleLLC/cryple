import { ApiError, NetworkError, assertCanonicalUuid, request } from '@/lib/api';
import { requireToken, type TokenContext } from '@/lib/context';
import { base64ToBytes, zeroBytes } from '@/lib/encoding';
import {
  signRootAction,
  type PinProofSigner,
  type RootActionEnvelope,
  type Signer,
} from '@/lib/signing';
import {
  blindPin,
  deriveAccountProofKey,
  deriveDevicePinKeys,
  finalizePin,
  generateDeviceSalt,
  proofSigner,
  signDeviceConfirmation,
  zeroDevicePinKeys,
  type AccountProofKey,
  type DevicePinKeys,
} from './pin-keys';

export class DeviceRegistrationGoneError extends Error {
  constructor() {
    super('this device PIN registration no longer exists');
    this.name = 'DeviceRegistrationGoneError';
  }
}

export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super('the server could not be reached', { cause });
    this.name = 'OfflineError';
  }
}

interface RegistrationAnswer {
  registration_id: string;
  evaluated_element: string;
}

interface EvaluationAnswer {
  evaluated_element: string;
  attempt_id: string;
  attempts_remaining: number;
}

export interface DeviceRegistration {
  registrationId: string;
  salt: Uint8Array;
  keys: DevicePinKeys;
}

export async function registerDevicePin(
  context: TokenContext,
  pin: string,
): Promise<DeviceRegistration> {
  const token = requireToken(context);
  const salt = generateDeviceSalt();
  const blinded = blindPin(pin);

  const answer = await request<RegistrationAnswer>({
    method: 'POST',
    path: '/oprf/devices',
    token,
    timeoutMs: context.timeoutMs,
    body: { blinded_element: blinded.blindedElement },
  });
  const registrationId = assertCanonicalUuid(answer.data.registration_id);
  const keys = await deriveDevicePinKeys(
    finalizePin(blinded, answer.data.evaluated_element),
    pin,
    salt,
  );

  try {
    await request<void>({
      method: 'POST',
      path: `/oprf/devices/${registrationId}/commit`,
      token,
      timeoutMs: context.timeoutMs,
      body: { confirm_public_key: keys.confirmPublicKey },
    });
  } catch (error) {
    zeroDevicePinKeys(keys);
    throw error;
  }

  return { registrationId, salt, keys };
}

export interface DevicePinEvaluation {
  keys: DevicePinKeys;
  attemptId: string;
  attemptsRemaining: number;
}

export async function evaluateDevicePin(
  registrationId: string,
  pin: string,
  salt: Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<DevicePinEvaluation> {
  const blinded = blindPin(pin);
  let answer: EvaluationAnswer;
  try {
    answer = (
      await request<EvaluationAnswer>({
        method: 'POST',
        path: `/oprf/devices/${assertCanonicalUuid(registrationId)}/evaluate`,
        timeoutMs: options.timeoutMs,
        body: { blinded_element: blinded.blindedElement },
      })
    ).data;
  } catch (error) {
    zeroBytes(blinded.blind);
    if (error instanceof ApiError && error.status === 404) {
      throw new DeviceRegistrationGoneError();
    }
    if (error instanceof NetworkError) {
      throw new OfflineError(error);
    }
    throw error;
  }

  const keys = await deriveDevicePinKeys(
    finalizePin(blinded, answer.evaluated_element),
    pin,
    salt,
  );
  return {
    keys,
    attemptId: assertCanonicalUuid(answer.attempt_id),
    attemptsRemaining: answer.attempts_remaining,
  };
}

export async function confirmDevicePin(
  registrationId: string,
  evaluation: DevicePinEvaluation,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/oprf/devices/${assertCanonicalUuid(registrationId)}/confirm`,
    timeoutMs: options.timeoutMs,
    body: {
      attempt_id: evaluation.attemptId,
      proof: signDeviceConfirmation(
        evaluation.keys.confirmSeed,
        registrationId,
        evaluation.attemptId,
      ),
    },
  });
}

export async function deleteDevicePin(
  context: TokenContext,
  registrationId: string,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/oprf/devices/${assertCanonicalUuid(registrationId)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
}

export async function accountPinProof(
  root: Signer,
  userAddress: string,
  pin: string,
  options: { timeoutMs?: number } = {},
): Promise<{ key: AccountProofKey; sign: PinProofSigner }> {
  const blinded = blindPin(pin);
  const envelope = await signRootAction(
    'pin-evaluate',
    [userAddress, blinded.blindedElement],
    root,
  );
  const answer = await request<{ evaluated_element: string }>({
    method: 'POST',
    path: '/oprf/account/evaluate',
    timeoutMs: options.timeoutMs,
    body: { user_address: userAddress, blinded_element: blinded.blindedElement, ...envelope },
  });
  const key = await deriveAccountProofKey(
    finalizePin(blinded, answer.data.evaluated_element),
    pin,
    userAddress,
  );
  return { key, sign: proofSigner(key) };
}

async function beginAccountPin(
  context: TokenContext,
  root: Signer,
  userAddress: string,
  newPin: string,
  currentProof?: PinProofSigner,
): Promise<AccountProofKey> {
  const blinded = blindPin(newPin);
  const envelope: RootActionEnvelope = await signRootAction(
    'second-factor-begin',
    [userAddress, blinded.blindedElement],
    root,
    currentProof,
  );
  const answer = await request<{ evaluated_element: string }>({
    method: 'POST',
    path: '/oprf/account/begin',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { blinded_element: blinded.blindedElement, ...envelope },
  });
  return deriveAccountProofKey(
    finalizePin(blinded, answer.data.evaluated_element),
    newPin,
    userAddress,
  );
}

export async function enableParanoid(
  context: TokenContext,
  root: Signer,
  userAddress: string,
  pin: string,
): Promise<void> {
  const key = await beginAccountPin(context, root, userAddress, pin);
  try {
    const envelope = await signRootAction('enable-second-factor', [key.publicKey], root);
    await request<void>({
      method: 'POST',
      path: '/oprf/account/enable',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: { proof_public_key: key.publicKey, ...envelope },
    });
  } finally {
    zeroBytes(key.seed);
  }
}

export async function rotateAccountPin(
  context: TokenContext,
  root: Signer,
  userAddress: string,
  currentPin: string,
  newPin: string,
): Promise<void> {
  const current = await accountPinProof(root, userAddress, currentPin, context);
  try {
    const next = await beginAccountPin(context, root, userAddress, newPin, current.sign);
    try {
      const envelope = await signRootAction(
        'rotate-second-factor',
        [next.publicKey],
        root,
        current.sign,
      );
      await request<void>({
        method: 'POST',
        path: '/oprf/account/rotate',
        token: requireToken(context),
        timeoutMs: context.timeoutMs,
        body: { proof_public_key: next.publicKey, ...envelope },
      });
    } finally {
      zeroBytes(next.seed);
    }
  } finally {
    zeroBytes(current.key.seed);
  }
}

export function decodeElement(element: string): Uint8Array {
  return base64ToBytes(element);
}
