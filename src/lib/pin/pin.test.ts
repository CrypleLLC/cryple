import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import {
  assertValidPin,
  deriveServerAuthToken,
  createSeedVault,
  hasSeedVault,
  unlockSeedVault,
  validatePin,
  MAX_UNLOCK_ATTEMPTS,
  PIN_PBKDF2_ITERATIONS,
  SEED_VAULT_KDF_VERSION,
  SEED_VAULT_STORAGE_KEY,
  type SeedVaultRecord,
  type VaultStorage,
} from './index';

const tokenVector = vectors.server_auth_token;
const userAddress = vectors.seed_and_user_address.user_address;
const mnemonic = vectors.seed_and_user_address.mnemonic;

function memoryStorage(): VaultStorage & { raw(): string | null } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    raw: () => map.get(SEED_VAULT_STORAGE_KEY) ?? null,
  };
}

describe('PIN format rules', () => {
  it('accepts a well-formed PIN', () => {
    expect(validatePin(tokenVector.pin)).toEqual({ valid: true });
    expect(() => assertValidPin('428193')).not.toThrow();
  });

  it('rejects the wrong length', () => {
    expect(validatePin('12345')).toEqual({ valid: false, reason: 'wrong-length' });
    expect(validatePin('1234567')).toEqual({ valid: false, reason: 'wrong-length' });
    expect(validatePin('')).toEqual({ valid: false, reason: 'wrong-length' });
  });

  it('rejects non-ASCII-digit characters', () => {
    expect(validatePin('12345a')).toEqual({ valid: false, reason: 'non-digit' });
    expect(validatePin('12 456')).toEqual({ valid: false, reason: 'non-digit' });
    expect(validatePin('١٢٣٤٥٦')).toEqual({ valid: false, reason: 'non-digit' });
  });

  it('rejects all-repeating digits', () => {
    for (const digit of '0123456789') {
      expect(validatePin(digit.repeat(6))).toEqual({
        valid: false,
        reason: 'repeating-digit',
      });
    }
  });

  it('rejects ascending and descending runs', () => {
    expect(validatePin('123456')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('012345')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('456789')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('654321')).toEqual({ valid: false, reason: 'descending-sequence' });
    expect(validatePin('987654')).toEqual({ valid: false, reason: 'descending-sequence' });
  });

  it('allows near-sequences that are not strict runs', () => {
    expect(validatePin('123457').valid).toBe(true);
    expect(validatePin('112233').valid).toBe(true);
  });
});

describe('Server_Auth_Token', () => {
  it('uses the frozen parameters', () => {
    expect(PIN_PBKDF2_ITERATIONS).toBe(tokenVector.iterations);
    expect(tokenVector.kdf).toBe('PBKDF2-HMAC-SHA256');
  });

  it('reproduces the vector token', async () => {
    const token = await deriveServerAuthToken(tokenVector.pin, userAddress);
    expect(token).toBe(tokenVector.server_auth_token_hex);
  });

  it('salts with the 64 UTF-8 bytes of the hex string, not the 32 raw bytes', async () => {
    const rawSaltToken = await (async () => {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(tokenVector.pin),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      const rawSalt = Uint8Array.from(
        userAddress.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
      );
      expect(rawSalt).toHaveLength(32);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: rawSalt, iterations: PIN_PBKDF2_ITERATIONS },
        key,
        256,
      );
      return [...new Uint8Array(bits)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    })();

    expect(rawSaltToken).not.toBe(tokenVector.server_auth_token_hex);
  });

  it('binds the token to the account', async () => {
    const other = `${'0'.repeat(63)}1`;
    expect(await deriveServerAuthToken(tokenVector.pin, other)).not.toBe(
      tokenVector.server_auth_token_hex,
    );
  });

  it('rejects a non-canonical user_address', async () => {
    await expect(deriveServerAuthToken(tokenVector.pin, userAddress.toUpperCase())).rejects.toThrow(
      /64 lowercase hex/,
    );
    await expect(deriveServerAuthToken(tokenVector.pin, 'abc')).rejects.toThrow();
  });
});

describe('local seed vault', () => {
  it('stores the documented record shape and never the plaintext', async () => {
    const storage = memoryStorage();
    const record = await createSeedVault(mnemonic, '428193', storage);

    expect(record.v).toBe(SEED_VAULT_KDF_VERSION);
    expect(Object.keys(record).sort()).toEqual(['ct', 'iv', 'salt', 'v']);

    const raw = storage.raw()!;
    expect(raw).not.toContain('abandon');
    expect(raw).not.toContain('428193');

    const parsed = JSON.parse(raw) as SeedVaultRecord;
    expect(atob(parsed.salt)).toHaveLength(32);
    expect(atob(parsed.iv)).toHaveLength(12);
  });

  it('round-trips the seed phrase under the right PIN', async () => {
    const storage = memoryStorage();
    await createSeedVault(mnemonic, '428193', storage);
    expect(await unlockSeedVault('428193', storage)).toEqual({
      status: 'unlocked',
      seedPhrase: mnemonic,
    });
  });

  it('derives a different wrapping key per device for the same PIN', async () => {
    const first = memoryStorage();
    const second = memoryStorage();
    const a = await createSeedVault(mnemonic, '428193', first);
    const b = await createSeedVault(mnemonic, '428193', second);

    expect(a.salt).not.toBe(b.salt);
    expect(a.ct).not.toBe(b.ct);
    expect(await unlockSeedVault('428193', second)).toEqual({
      status: 'unlocked',
      seedPhrase: mnemonic,
    });
  });

  it('refuses to create a vault under a PIN that breaks the format rules', async () => {
    const storage = memoryStorage();
    await expect(createSeedVault(mnemonic, '123456', storage)).rejects.toThrow(
      /ascending-sequence/,
    );
    expect(hasSeedVault(storage)).toBe(false);
  });

  it('wipes the local copy on the third failed attempt', async () => {
    const storage = memoryStorage();
    await createSeedVault(mnemonic, '428193', storage);

    expect(await unlockSeedVault('428194', storage)).toEqual({
      status: 'invalid-pin',
      attemptsRemaining: 2,
    });
    expect(hasSeedVault(storage)).toBe(true);

    expect(await unlockSeedVault('428195', storage)).toEqual({
      status: 'invalid-pin',
      attemptsRemaining: 1,
    });
    expect(hasSeedVault(storage)).toBe(true);

    expect(await unlockSeedVault('428196', storage)).toEqual({ status: 'wiped' });
    expect(hasSeedVault(storage)).toBe(false);
    expect(await unlockSeedVault('428193', storage)).toEqual({ status: 'no-vault' });
  });

  it('counts failures across reloads and resets them after a success', async () => {
    const storage = memoryStorage();
    await createSeedVault(mnemonic, '428193', storage);

    await unlockSeedVault('428194', storage);
    await unlockSeedVault('428195', storage);
    expect(JSON.parse(storage.raw()!).failed).toBe(MAX_UNLOCK_ATTEMPTS - 1);

    expect((await unlockSeedVault('428193', storage)).status).toBe('unlocked');
    expect(JSON.parse(storage.raw()!).failed).toBeUndefined();

    await unlockSeedVault('428194', storage);
    expect(await unlockSeedVault('428195', storage)).toEqual({
      status: 'invalid-pin',
      attemptsRemaining: 1,
    });
  });

  it('reports a missing vault distinctly from a wrong PIN', async () => {
    expect(await unlockSeedVault('428193', memoryStorage())).toEqual({ status: 'no-vault' });
  });

  it('refuses a record written by an unknown KDF version', async () => {
    const storage = memoryStorage();
    await createSeedVault(mnemonic, '428193', storage);
    const record = JSON.parse(storage.raw()!) as SeedVaultRecord;
    storage.setItem(SEED_VAULT_STORAGE_KEY, JSON.stringify({ ...record, v: 2 }));

    await expect(unlockSeedVault('428193', storage)).rejects.toThrow(/unsupported seed vault/);
  });
});
