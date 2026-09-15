import type { AuthedContext } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { openText, sealText } from '@/lib/sealed';
import { generateDek, vaultKekDekWrapper, type DekWrapper } from '@/lib/secrets';

export const FINGERPRINT_PINS_STORAGE_KEY = 'cryple.sharing.pins';
export const LEGACY_FINGERPRINT_PIN_PREFIX = 'cryple.sharing.fingerprint.';
export const FINGERPRINT_PINS_VERSION = 1;

export interface PinStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface FingerprintPinOptions {
  wrapper: DekWrapper;
  storage?: PinStorage;
}

export type FingerprintPins = Readonly<Record<string, string>>;

interface SealedPinsRecord {
  v: typeof FINGERPRINT_PINS_VERSION;
  wrapped_dek: string;
  ciphertext: string;
}

export function fingerprintPinOptions(context: AuthedContext): FingerprintPinOptions {
  return { wrapper: vaultKekDekWrapper(context.session.vaultKek) };
}

function browserStorage(): PinStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isSealedRecord(value: unknown): value is SealedPinsRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<SealedPinsRecord>;
  return (
    record.v === FINGERPRINT_PINS_VERSION &&
    typeof record.wrapped_dek === 'string' &&
    typeof record.ciphertext === 'string'
  );
}

function isPinMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

async function readSealed(storage: PinStorage, wrapper: DekWrapper): Promise<Record<string, string>> {
  const raw = storage.getItem(FINGERPRINT_PINS_STORAGE_KEY);
  if (raw === null) {
    return {};
  }

  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isSealedRecord(record)) {
    return {};
  }

  let dek: Uint8Array;
  try {
    dek = await wrapper.unwrapDek(record.wrapped_dek);
  } catch {
    return {};
  }

  try {
    const pins: unknown = JSON.parse(await openText(record.ciphertext, dek));
    return isPinMap(pins) ? { ...pins } : {};
  } catch {
    return {};
  } finally {
    zeroBytes(dek);
  }
}

async function writeSealed(
  storage: PinStorage,
  wrapper: DekWrapper,
  pins: Record<string, string>,
): Promise<void> {
  const dek = generateDek();
  try {
    const record: SealedPinsRecord = {
      v: FINGERPRINT_PINS_VERSION,
      wrapped_dek: await wrapper.wrapDek(dek),
      ciphertext: await sealText(JSON.stringify(pins), dek),
    };
    storage.setItem(FINGERPRINT_PINS_STORAGE_KEY, JSON.stringify(record));
  } finally {
    zeroBytes(dek);
  }
}

function legacyPinKeys(storage: PinStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(LEGACY_FINGERPRINT_PIN_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

async function loadMigrating(storage: PinStorage, wrapper: DekWrapper): Promise<Record<string, string>> {
  const sealed = await readSealed(storage, wrapper);
  const legacyKeys = legacyPinKeys(storage);
  if (legacyKeys.length === 0) {
    return sealed;
  }

  const legacy: Record<string, string> = {};
  for (const key of legacyKeys) {
    const fingerprint = storage.getItem(key);
    if (fingerprint !== null) {
      legacy[key.slice(LEGACY_FINGERPRINT_PIN_PREFIX.length)] = fingerprint;
    }
  }

  const merged = { ...legacy, ...sealed };
  await writeSealed(storage, wrapper, merged);
  for (const key of legacyKeys) {
    storage.removeItem(key);
  }
  return merged;
}

let pending: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = pending.then(work);
  pending = run.catch(() => undefined);
  return run;
}

export function readFingerprintPins(options: FingerprintPinOptions): Promise<FingerprintPins> {
  const storage = options.storage ?? browserStorage();
  if (storage === undefined) {
    return Promise.resolve({});
  }
  return oneAtATime(() => loadMigrating(storage, options.wrapper));
}

export async function readFingerprintPin(
  connectionId: string,
  options: FingerprintPinOptions,
): Promise<string | undefined> {
  return (await readFingerprintPins(options))[connectionId];
}

export async function sealLegacyFingerprintPins(options: FingerprintPinOptions): Promise<void> {
  await readFingerprintPins(options);
}

export function pinFingerprint(
  connectionId: string,
  fingerprint: string,
  options: FingerprintPinOptions,
): Promise<string> {
  const storage = options.storage ?? browserStorage();
  if (storage === undefined) {
    return Promise.resolve(fingerprint);
  }
  return oneAtATime(async () => {
    const pins = await loadMigrating(storage, options.wrapper);
    const standing = pins[connectionId];
    if (standing !== undefined) {
      return standing;
    }
    await writeSealed(storage, options.wrapper, { ...pins, [connectionId]: fingerprint });
    return fingerprint;
  });
}

export function wipeFingerprintPins(storage: PinStorage | undefined = browserStorage()): void {
  if (storage === undefined) {
    return;
  }
  for (const key of legacyPinKeys(storage)) {
    storage.removeItem(key);
  }
  storage.removeItem(FINGERPRINT_PINS_STORAGE_KEY);
}
