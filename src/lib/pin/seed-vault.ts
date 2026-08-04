import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { stretchPin } from './kdf';
import { assertValidPin } from './rules';

export const SEED_VAULT_STORAGE_KEY = 'encrypted_seed';
export const SEED_VAULT_KDF_VERSION = 1;
export const MAX_UNLOCK_ATTEMPTS = 3;

const LOCAL_SALT_LENGTH = 32;
const GCM_IV_LENGTH = 12;

export interface SeedVaultRecord {
  v: number;
  salt: string;
  iv: string;
  ct: string;
  failed?: number;
}

export interface VaultStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type UnlockResult =
  | { status: 'unlocked'; seedPhrase: string }
  | { status: 'invalid-pin'; attemptsRemaining: number }
  | { status: 'wiped' }
  | { status: 'no-vault' };

function defaultStorage(): VaultStorage {
  if (typeof localStorage === 'undefined') {
    throw new Error('no local storage available — pass an explicit VaultStorage');
  }
  return localStorage;
}

function readRecord(storage: VaultStorage): SeedVaultRecord | undefined {
  const raw = storage.getItem(SEED_VAULT_STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SeedVaultRecord;
    if (parsed.v !== SEED_VAULT_KDF_VERSION) {
      throw new Error(`unsupported seed vault KDF version: ${parsed.v}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

async function importAesKey(material: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export function hasSeedVault(storage: VaultStorage = defaultStorage()): boolean {
  return readRecord(storage) !== undefined;
}

export function wipeSeedVault(storage: VaultStorage = defaultStorage()): void {
  storage.removeItem(SEED_VAULT_STORAGE_KEY);
}

export async function createSeedVault(
  seedPhrase: string,
  pin: string,
  storage: VaultStorage = defaultStorage(),
): Promise<SeedVaultRecord> {
  assertValidPin(pin);

  const salt = crypto.getRandomValues(new Uint8Array(LOCAL_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH));

  const wrapKey = await stretchPin(pin, salt);
  const aesKey = await importAesKey(wrapKey);
  zeroBytes(wrapKey);

  const plaintext = utf8ToBytes(seedPhrase);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext),
  );
  zeroBytes(plaintext);

  const record: SeedVaultRecord = {
    v: SEED_VAULT_KDF_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ciphertext),
  };
  storage.setItem(SEED_VAULT_STORAGE_KEY, JSON.stringify(record));
  return record;
}

export async function unlockSeedVault(
  pin: string,
  storage: VaultStorage = defaultStorage(),
): Promise<UnlockResult> {
  const record = readRecord(storage);
  if (record === undefined) {
    return { status: 'no-vault' };
  }

  const salt = base64ToBytes(record.salt);
  const iv = base64ToBytes(record.iv);
  const ciphertext = base64ToBytes(record.ct);

  const wrapKey = await stretchPin(pin, salt);
  const aesKey = await importAesKey(wrapKey);
  zeroBytes(wrapKey);

  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext),
    );
  } catch {
    const failed = (record.failed ?? 0) + 1;
    if (failed >= MAX_UNLOCK_ATTEMPTS) {
      wipeSeedVault(storage);
      return { status: 'wiped' };
    }
    storage.setItem(SEED_VAULT_STORAGE_KEY, JSON.stringify({ ...record, failed }));
    return { status: 'invalid-pin', attemptsRemaining: MAX_UNLOCK_ATTEMPTS - failed };
  }

  if (record.failed !== undefined) {
    const { failed: _cleared, ...reset } = record;
    storage.setItem(SEED_VAULT_STORAGE_KEY, JSON.stringify(reset));
  }

  const seedPhrase = bytesToUtf8(plaintext);
  zeroBytes(plaintext);
  return { status: 'unlocked', seedPhrase };
}
