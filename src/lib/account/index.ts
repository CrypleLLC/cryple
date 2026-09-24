import { ApiError, type TokenStore } from '@/lib/api';
import {
  AuthRejectedError,
  enrolWithRoot,
  readChainWithRoot,
  signInDevice,
  signUpWithGenesis,
  type RootChainAnswer,
} from '@/lib/auth';
import { ChainState, InvalidChainError, type StoredChainEvent } from '@/lib/chain';
import type { AuthedContext, TokenContext } from '@/lib/context';
import {
  deviceDeclaration,
  deviceSigner,
  generateDeviceKeys,
  x25519Agreement,
  zeroDeviceKeys,
  type DeviceKeys,
} from '@/lib/device/keys';
import {
  WrongDevicePinError,
  openDeviceRecord,
  recordIdentity,
  sealDeviceRecord,
  type DeviceIdentity,
  type DeviceRecord,
} from '@/lib/device/record';
import type { DeviceRecordStore } from '@/lib/device/store';
import { base64ToBytes, bytesToBase64 } from '@/lib/encoding';
import {
  deriveRootKeysFromMnemonic,
  zeroRootKeys,
  type RootKeys,
} from '@/lib/keys';
import {
  applyDeviceBatch,
  buildDeviceRemoval,
  buildEnrolment,
  buildGenesis,
  currentFrom,
  openRootKeyrings,
  postOwnWraps,
  wrapKekForDevice,
  type KeyringWrap,
  buildSelfRemoval,
  fetchChain,
  loadKeyrings,
  wrapKekForRoot,
  zeroCreated,
  type BuiltBatch,
  type DeviceSecrets,
} from '@/lib/keyrings';
import {
  DeviceRegistrationGoneError,
  OfflineError,
  accountPinProof,
  confirmDevicePin,
  enableParanoid,
  evaluateDevicePin,
  registerDevicePin,
  zeroDevicePinKeys,
  type AccountProofKey,
} from '@/lib/oprf';
import { FULL_DEVICE_SCOPES, type Scope } from '@/lib/scopes';
import type { KeyringEntry, SessionKeystore } from '@/lib/session';
import { rawKeySigner, type PinProofSigner } from '@/lib/signing';
import { deleteAccount, lookupUsername } from '@/lib/users';

export class DeviceRemovedError extends Error {
  constructor() {
    super('this device is no longer enrolled in the account');
    this.name = 'DeviceRemovedError';
  }
}

export class ChainNotVerifiedError extends Error {
  constructor(cause: unknown) {
    super('the account event chain the server returned does not verify from the root key', {
      cause,
    });
    this.name = 'ChainNotVerifiedError';
  }
}

export interface AccountServices {
  session: SessionKeystore;
  tokens: TokenStore;
  store: DeviceRecordStore;
  timeoutMs?: number;
}

export function deviceSecretsOf(keys: DeviceKeys): DeviceSecrets {
  return {
    deviceId: keys.deviceId,
    x25519: x25519Agreement(keys.x25519),
    mlkemSecretKey: keys.mlkemSecretKey,
  };
}

export function verifyOwnChain(
  identity: Pick<DeviceIdentity, 'userAddress' | 'rootPublicKey'>,
  deviceId: string,
  events: readonly StoredChainEvent[],
): ChainState {
  let state: ChainState;
  try {
    state = ChainState.replay(identity.userAddress, identity.rootPublicKey, events);
  } catch (error) {
    throw new ChainNotVerifiedError(error);
  }
  if (!state.devices.get(deviceId)?.active) {
    throw new DeviceRemovedError();
  }
  return state;
}

export async function readVerifiedChain(
  context: TokenContext,
  identity: Pick<DeviceIdentity, 'userAddress' | 'rootPublicKey'>,
  deviceId: string,
): Promise<ChainState> {
  return verifyOwnChain(identity, deviceId, await fetchChain(context));
}

async function persistDevice(
  services: AccountServices,
  keys: DeviceKeys,
  identity: DeviceIdentity,
  pin: string,
): Promise<DeviceRecord> {
  const registration = await registerDevicePin(services, pin);
  try {
    const record = await sealDeviceRecord({
      keys,
      identity,
      registrationId: registration.registrationId,
      salt: registration.salt,
      wrapKey: registration.keys.wrapKey,
    });
    await services.store.write(record);
    return record;
  } finally {
    zeroDevicePinKeys(registration.keys);
  }
}

function openSession(
  services: AccountServices,
  identity: DeviceIdentity,
  record: DeviceRecord,
  device: DeviceKeys,
  keyrings: readonly KeyringEntry[],
  current: Partial<Record<string, number>>,
): void {
  services.session.open({
    userAddress: identity.userAddress,
    rootPublicKey: identity.rootPublicKey,
    deviceId: device.deviceId,
    registrationId: record.registration_id,
    scopes: identity.scopes,
    device,
    keyrings,
    current,
  });
}

export interface SignUpDraft {
  root: RootKeys;
  device: DeviceKeys;
  built: BuiltBatch;
}

export async function draftSignUp(mnemonic: string): Promise<SignUpDraft> {
  const root = await deriveRootKeysFromMnemonic(mnemonic);
  const device = await generateDeviceKeys();
  try {
    const built = await buildGenesis({
      userAddress: root.userAddress,
      rootPublicKey: root.signing.publicKeySpkiBase64,
      root: rawKeySigner(root.signing.privateKey),
      wrapForRoot: (kek) => wrapKekForRoot(root.wrapKey, kek),
      device: deviceDeclaration(device, FULL_DEVICE_SCOPES),
    });
    return { root, device, built };
  } catch (error) {
    zeroRootKeys(root);
    zeroDeviceKeys(device);
    throw error;
  }
}

export function discardSignUpDraft(draft: SignUpDraft | undefined): void {
  if (draft === undefined) {
    return;
  }
  zeroRootKeys(draft.root);
  zeroDeviceKeys(draft.device);
  zeroCreated(draft.built.created);
}

export interface SignUpResult {
  created: boolean;
  paranoid: boolean;
  paranoidFailure?: unknown;
}

export async function completeSignUp(
  services: AccountServices,
  draft: SignUpDraft,
  options: { pin: string; paranoid: boolean },
): Promise<SignUpResult> {
  const { root, device, built } = draft;
  const identity: DeviceIdentity = {
    userAddress: root.userAddress,
    rootPublicKey: root.signing.publicKeySpkiBase64,
    scopes: FULL_DEVICE_SCOPES as Scope[],
  };
  const rootSigner = rawKeySigner(root.signing.privateKey);

  const outcome = await signUpWithGenesis({
    userAddress: root.userAddress,
    rootPublicKey: root.signing.publicKeySpkiBase64,
    root: rootSigner,
    batch: built.batch,
    tokens: services.tokens,
    timeoutMs: services.timeoutMs,
  });
  if (outcome.grant.device_id !== device.deviceId) {
    throw new Error('the server answered for another device than the genesis names');
  }

  await readVerifiedChain(services, identity, device.deviceId);
  const record = await persistDevice(services, device, identity, options.pin);

  let paranoidFailure: unknown;
  if (options.paranoid) {
    try {
      await enableParanoid(services, rootSigner, root.userAddress, options.pin);
    } catch (error) {
      paranoidFailure = error;
    }
  }

  const sealed = built.batch.materials.find((material) => material.scope === 'sharing');
  const keyrings: KeyringEntry[] = built.created.map((generation) => ({
    scope: generation.scope,
    generation: generation.generation,
    kek: generation.kek,
    sealedMaterial: generation.scope === 'sharing' ? sealed?.sealed_material : undefined,
  }));
  for (const generation of built.created) {
    if (generation.sharingKeys !== undefined) {
      generation.sharingKeys.x25519PrivateKey.fill(0);
      generation.sharingKeys.mlkemSeed.fill(0);
      generation.sharingKeys.mlkemSecretKey.fill(0);
    }
  }
  zeroRootKeys(root);

  openSession(
    services,
    identity,
    record,
    device,
    keyrings,
    Object.fromEntries(built.created.map((generation) => [generation.scope, generation.generation])),
  );

  return {
    created: outcome.created,
    paranoid: options.paranoid && paranoidFailure === undefined,
    paranoidFailure,
  };
}

export type UnlockOutcome =
  | { status: 'unlocked'; chainProblem?: ChainNotVerifiedError }
  | { status: 'no-device' }
  | { status: 'wrong-pin'; attemptsRemaining: number }
  | { status: 'forgotten' }
  | { status: 'removed' }
  | { status: 'offline' }
  | { status: 'rate-limited'; retryAfterSeconds?: number };

export async function unlockWithPin(services: AccountServices, pin: string): Promise<UnlockOutcome> {
  const record = await services.store.read();
  if (record === undefined) {
    return { status: 'no-device' };
  }

  let evaluation;
  try {
    evaluation = await evaluateDevicePin(record.registration_id, pin, base64ToBytes(record.salt), {
      timeoutMs: services.timeoutMs,
    });
  } catch (error) {
    if (error instanceof DeviceRegistrationGoneError) {
      await forgetThisBrowser(services, record);
      return { status: 'forgotten' };
    }
    if (error instanceof OfflineError) {
      return { status: 'offline' };
    }
    if (error instanceof ApiError && error.isRateLimited) {
      return { status: 'rate-limited', retryAfterSeconds: error.retryAfterSeconds };
    }
    throw error;
  }

  let device: DeviceKeys;
  try {
    device = await openDeviceRecord(record, evaluation.keys.wrapKey);
  } catch (error) {
    zeroDevicePinKeys(evaluation.keys);
    if (error instanceof WrongDevicePinError) {
      if (evaluation.attemptsRemaining <= 0) {
        await forgetThisBrowser(services, record);
        return { status: 'forgotten' };
      }
      return { status: 'wrong-pin', attemptsRemaining: evaluation.attemptsRemaining };
    }
    throw error;
  }

  try {
    await confirmDevicePin(record.registration_id, evaluation, { timeoutMs: services.timeoutMs });
  } finally {
    zeroDevicePinKeys(evaluation.keys);
  }

  try {
    await signInDevice({
      deviceId: record.device_id,
      signer: deviceSigner(device),
      tokens: services.tokens,
      timeoutMs: services.timeoutMs,
    });
  } catch (error) {
    if (error instanceof AuthRejectedError) {
      zeroDeviceKeys(device);
      await services.store.remove();
      return { status: 'removed' };
    }
    zeroDeviceKeys(device);
    throw error;
  }

  let identity = recordIdentity(record);
  let chainProblem: ChainNotVerifiedError | undefined;
  try {
    const state = await readVerifiedChain(services, identity, record.device_id);
    const held = state.devices.get(record.device_id)?.scopes;
    if (held !== undefined) {
      identity = { ...identity, scopes: FULL_DEVICE_SCOPES.filter((scope) => held.has(scope)) };
    }
  } catch (error) {
    if (error instanceof DeviceRemovedError) {
      zeroDeviceKeys(device);
      services.tokens.clear();
      await services.store.remove();
      return { status: 'removed' };
    }
    if (!(error instanceof ChainNotVerifiedError)) {
      zeroDeviceKeys(device);
      services.tokens.clear();
      throw error;
    }
    chainProblem = error;
  }

  try {
    const { entries, current } = await loadKeyrings(
      services,
      identity.userAddress,
      deviceSecretsOf(device),
    );
    openSession(services, identity, record, device, entries, current);
  } catch (error) {
    zeroDeviceKeys(device);
    services.tokens.clear();
    throw error;
  }

  return { status: 'unlocked', chainProblem };
}

export async function renewSignIn(services: Pick<AccountServices, 'session' | 'tokens' | 'timeoutMs'>): Promise<void> {
  try {
    await signInDevice({
      deviceId: services.session.deviceId,
      signer: services.session.signer(),
      tokens: services.tokens,
      timeoutMs: services.timeoutMs,
    });
  } catch (error) {
    if (error instanceof AuthRejectedError) {
      throw new DeviceRemovedError();
    }
    throw error;
  }
}

async function signOffWithKey(
  services: AccountServices,
  identity: DeviceIdentity,
  deviceId: string,
  signingKey: CryptoKey,
): Promise<void> {
  const signer = deviceSigner({ signingKey });
  if (services.tokens.get() === undefined) {
    await signInDevice({ deviceId, signer, tokens: services.tokens, timeoutMs: services.timeoutMs });
  }
  const state = await readVerifiedChain(services, identity, deviceId);
  const batch = await buildSelfRemoval({ state, author: { name: deviceId, signer } });
  await applyDeviceBatch(services, batch);
}

export async function forgetThisBrowser(
  services: AccountServices,
  record?: DeviceRecord,
): Promise<void> {
  const known = record ?? (await services.store.read());
  if (known !== undefined) {
    await signOffWithKey(services, recordIdentity(known), known.device_id, known.signing_key).catch(
      () => undefined,
    );
  }
  services.tokens.clear();
  services.session.lock();
  await services.store.remove();
}

export async function removeThisBrowser(services: AccountServices): Promise<void> {
  const record = await services.store.read();
  if (record === undefined) {
    throw new Error('this browser holds no device record');
  }
  await signOffWithKey(services, recordIdentity(record), record.device_id, record.signing_key);
  services.tokens.clear();
  services.session.lock();
  await services.store.remove();
}

export async function changeDevicePin(services: AccountServices, newPin: string): Promise<void> {
  const record = await services.store.read();
  if (record === undefined) {
    throw new Error('this browser holds no device record');
  }
  const device = services.session.device;
  const identity = recordIdentity(record);
  const next = await persistDevice(services, device, identity, newPin);
  services.session.setRegistration(next.registration_id);
}

export { InvalidChainError };

export class NoAccountForPhraseError extends Error {
  constructor() {
    super('no account uses this recovery phrase');
    this.name = 'NoAccountForPhraseError';
  }
}

export class TooManyDevicesError extends Error {
  readonly devices: readonly DeviceSummary[];

  constructor(devices: readonly DeviceSummary[]) {
    super('the account already holds the maximum number of devices');
    this.name = 'TooManyDevicesError';
    this.devices = devices;
  }
}

export interface DeviceSummary {
  id: string;
  scopes: string;
  createdAt: string;
}

export async function accountExists(userAddress: string, timeoutMs?: number): Promise<boolean> {
  try {
    await lookupUsername(userAddress, { timeoutMs });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

interface RootAccess {
  chain: RootChainAnswer;
  proof?: { key: AccountProofKey; sign: PinProofSigner };
}

async function readChainAsOwner(
  root: RootKeys,
  accountPin: string | undefined,
  timeoutMs?: number,
): Promise<RootAccess> {
  const signer = rawKeySigner(root.signing.privateKey);
  try {
    return { chain: await readChainWithRoot({ userAddress: root.userAddress, root: signer, timeoutMs }) };
  } catch (error) {
    if (!(error instanceof AuthRejectedError) || accountPin === undefined) {
      throw error;
    }
  }
  const proof = await accountPinProof(signer, root.userAddress, accountPin, { timeoutMs });
  try {
    const chain = await readChainWithRoot({
      userAddress: root.userAddress,
      root: signer,
      pinProof: proof.sign,
      timeoutMs,
    });
    return { chain, proof };
  } catch (error) {
    proof.key.seed.fill(0);
    throw error;
  }
}

export interface EnrolmentResult {
  paranoid: boolean;
  removed: readonly string[];
}

export async function enrolThisBrowser(
  services: AccountServices,
  options: {
    mnemonic: string;
    pin: string;
    removeDeviceIds?: readonly string[] | 'all';
  },
): Promise<EnrolmentResult> {
  const root = await deriveRootKeysFromMnemonic(options.mnemonic);
  const rootPublicKey = root.signing.publicKeySpkiBase64;
  const signer = rawKeySigner(root.signing.privateKey);
  let device: DeviceKeys | undefined;
  let access: RootAccess | undefined;

  try {
    if (!(await accountExists(root.userAddress, services.timeoutMs))) {
      throw new NoAccountForPhraseError();
    }

    access = await readChainAsOwner(root, options.pin, services.timeoutMs);
    let state: ChainState;
    try {
      state = ChainState.replay(root.userAddress, rootPublicKey, access.chain.chain);
    } catch (error) {
      throw new ChainNotVerifiedError(error);
    }

    const active = state.activeDeviceIds();
    const removeDeviceIds =
      options.removeDeviceIds === 'all' ? active : (options.removeDeviceIds ?? []);

    device = await generateDeviceKeys();
    const identity: DeviceIdentity = {
      userAddress: root.userAddress,
      rootPublicKey,
      scopes: FULL_DEVICE_SCOPES as Scope[],
    };
    const built = await buildEnrolment({
      state,
      root: signer,
      wrapForRoot: (kek) => wrapKekForRoot(root.wrapKey, kek),
      device: deviceDeclaration(device, FULL_DEVICE_SCOPES),
      removeDeviceIds,
    });
    zeroCreated(built.created);

    let answer;
    try {
      answer = await enrolWithRoot({
        userAddress: root.userAddress,
        root: signer,
        batch: built.batch,
        pinProof: access.proof?.sign,
        tokens: services.tokens,
        timeoutMs: services.timeoutMs,
      });
    } catch (error) {
      if (error instanceof ApiError && error.isTooManyDevices) {
        throw new TooManyDevicesError(
          access.chain.devices.map((entry) => ({
            id: entry.id,
            scopes: entry.scopes,
            createdAt: entry.created_at,
          })),
        );
      }
      throw error;
    }

    const enrolled = verifyOwnChain(identity, device.deviceId, answer.chain);
    const rootEntries = await openRootKeyrings(answer.root_keyrings, root.wrapKey);
    const created = new Set(built.created.map((generation) => `${generation.scope}:${generation.generation}`));
    const heldScopes = new Set<string>(identity.scopes);
    const wraps: KeyringWrap[] = [];
    for (const entry of rootEntries) {
      if (!heldScopes.has(entry.scope) || created.has(`${entry.scope}:${entry.generation}`)) {
        continue;
      }
      wraps.push({
        scope: entry.scope,
        generation: entry.generation,
        recipient: device.deviceId,
        wrapped_key: await wrapKekForDevice(entry.kek, root.userAddress, {
          deviceId: device.deviceId,
          x25519PublicKey: bytesToBase64(device.x25519PublicKey),
          mlkemPublicKey: bytesToBase64(device.mlkemPublicKey),
        }),
      });
    }
    await postOwnWraps(services, wraps);

    const record = await persistDevice(services, device, identity, options.pin);
    openSession(
      services,
      identity,
      record,
      device,
      rootEntries.filter((entry) => heldScopes.has(entry.scope)),
      currentFrom(answer.root_keyrings),
    );
    device = undefined;

    return {
      paranoid: access.proof !== undefined,
      removed: removeDeviceIds.filter((id) => !enrolled.devices.get(id)?.active),
    };
  } finally {
    zeroRootKeys(root);
    access?.proof?.key.seed.fill(0);
    zeroDeviceKeys(device);
  }
}

export class PhraseMismatchError extends Error {
  constructor() {
    super('that recovery phrase belongs to a different account');
    this.name = 'PhraseMismatchError';
  }
}

async function withAccountRoot<T>(
  expectedAddress: string,
  mnemonic: string,
  run: (root: RootKeys) => Promise<T>,
): Promise<T> {
  const root = await deriveRootKeysFromMnemonic(mnemonic);
  try {
    if (root.userAddress !== expectedAddress) {
      throw new PhraseMismatchError();
    }
    return await run(root);
  } finally {
    zeroRootKeys(root);
  }
}

export async function removeOtherDevices(
  context: AuthedContext,
  mnemonic: string,
  deviceIds: readonly string[],
): Promise<string[]> {
  const { session } = context;
  const rotated: string[] = [];
  await withAccountRoot(session.userAddress, mnemonic, async (root) => {
    const state = await readVerifiedChain(
      context,
      { userAddress: session.userAddress, rootPublicKey: session.rootPublicKey },
      session.deviceId,
    );
    const built = await buildDeviceRemoval({
      state,
      author: { name: session.deviceId, signer: session.signer() },
      wrapForRoot: (kek) => wrapKekForRoot(root.wrapKey, kek),
      removeDeviceIds: deviceIds,
    });
    try {
      await applyDeviceBatch(context, built.batch);
    } catch (error) {
      zeroCreated(built.created);
      throw error;
    }
    const sealed = built.batch.materials.find((material) => material.scope === 'sharing');
    session.addKeyrings(
      built.created
        .filter((generation) => session.holds(generation.scope))
        .map((generation) => ({
          scope: generation.scope,
          generation: generation.generation,
          kek: generation.kek,
          sealedMaterial:
            generation.scope === 'sharing' && sealed?.generation === generation.generation
              ? sealed.sealed_material
              : undefined,
        })),
      Object.fromEntries(built.created.map((generation) => [generation.scope, generation.generation])),
    );
    rotated.push(...built.created.map((generation) => generation.scope));
    for (const generation of built.created) {
      zeroSharingPair(generation.sharingKeys);
    }
  });

  return rotated;
}

function zeroSharingPair(keys: BuiltBatch['created'][number]['sharingKeys']): void {
  if (keys !== undefined) {
    keys.x25519PrivateKey.fill(0);
    keys.mlkemSeed.fill(0);
    keys.mlkemSecretKey.fill(0);
  }
}

export async function deleteAccountWithPhrase(
  services: AccountServices,
  context: AuthedContext,
  options: { mnemonic: string; accountPin?: string },
): Promise<void> {
  await withAccountRoot(context.session.userAddress, options.mnemonic, async (root) => {
    const signer = rawKeySigner(root.signing.privateKey);
    let proof: { key: AccountProofKey; sign: PinProofSigner } | undefined;
    try {
      if (context.paranoid) {
        if (options.accountPin === undefined) {
          throw new Error('a Paranoid account is deleted with its account PIN');
        }
        proof = await accountPinProof(signer, root.userAddress, options.accountPin, context);
      }
      await deleteAccount(context, signer, proof?.sign);
    } finally {
      proof?.key.seed.fill(0);
    }
  });
  services.tokens.clear();
  services.session.lock();
  await services.store.remove();
}
