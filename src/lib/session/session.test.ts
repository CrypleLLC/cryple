import { describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToHex } from '@/lib/encoding';
import { createSeedVault, SEED_VAULT_STORAGE_KEY, type VaultStorage } from '@/lib/pin';
import { SessionKeystore } from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const userAddress = vectors.seed_and_user_address.user_address;
const identityVector = vectors.identity_key_p256;
const tokenVector = vectors.server_auth_token;
const pin = tokenVector.pin;

function memoryStorage(): VaultStorage & { entries(): [string, string][] } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    entries: () => [...map.entries()],
  };
}

async function unlockedKeystore(idleTimeoutMs = 0) {
  const storage = memoryStorage();
  await createSeedVault(mnemonic, pin, storage);
  const keystore = new SessionKeystore({ storage, idleTimeoutMs });
  const result = await keystore.unlock(pin);
  return { keystore, storage, result };
}

describe('session unlock', () => {
  it('derives the whole key tree from one PIN entry', async () => {
    const { keystore, result } = await unlockedKeystore();

    expect(result).toEqual({ status: 'unlocked', userAddress });
    expect(keystore.isUnlocked).toBe(true);
    expect(keystore.userAddress).toBe(userAddress);
    expect(bytesToHex(keystore.identityPrivateKey)).toBe(identityVector.private_key_hex);
    expect(keystore.identityPublicKeySpkiBase64).toBe(identityVector.public_key_spki_base64);
    expect(bytesToHex(keystore.x25519PrivateKey)).toBe(
      vectors.x25519_key.private_key_or_seed_hex,
    );
    expect(bytesToHex(keystore.mlkem768PublicKey)).toBe(vectors.mlkem768_key.public_key_hex);
  });

  it('holds the Server_Auth_Token so the PIN is never needed again', async () => {
    const { keystore } = await unlockedKeystore();
    expect(keystore.serverAuthToken()).toBe(tokenVector.server_auth_token_hex);
    expect(keystore.serverAuthToken()).toBe(tokenVector.server_auth_token_hex);
  });

  it('exposes the three enrollment public keys in wire encoding', async () => {
    const { keystore } = await unlockedKeystore();
    expect(keystore.enrollmentPublicKeys).toEqual({
      publicKey: identityVector.public_key_spki_base64,
      encryptionPublicKeyX25519: vectors.x25519_key.public_key_base64,
      encryptionPublicKeyMlkem: vectors.mlkem768_key.public_key_base64,
    });
  });

  it('unlocks directly from a mnemonic for restore before a vault exists', async () => {
    const keystore = new SessionKeystore({ storage: memoryStorage(), idleTimeoutMs: 0 });
    expect(await keystore.unlockWithMnemonic(mnemonic, pin)).toBe(userAddress);
    expect(keystore.serverAuthToken()).toBe(tokenVector.server_auth_token_hex);
  });

  it('unlocks from a mnemonic alone, holding no second factor — Standard Mode has no PIN', async () => {
    const keystore = new SessionKeystore({ storage: memoryStorage(), idleTimeoutMs: 0 });

    expect(await keystore.unlockWithMnemonic(mnemonic)).toBe(userAddress);
    expect(keystore.isUnlocked).toBe(true);
    expect(bytesToHex(keystore.identityPrivateKey)).toBe(identityVector.private_key_hex);
    expect(keystore.serverAuthToken()).toBeUndefined();
  });

  it('still refuses the token when locked, rather than reporting a missing second factor', async () => {
    const keystore = new SessionKeystore({ storage: memoryStorage(), idleTimeoutMs: 0 });
    await keystore.unlockWithMnemonic(mnemonic);
    keystore.lock();

    expect(() => keystore.serverAuthToken()).toThrow(/locked/);
  });

  it('takes on a second factor when a Standard account enables one', async () => {
    const keystore = new SessionKeystore({ storage: memoryStorage(), idleTimeoutMs: 0 });
    await keystore.unlockWithMnemonic(mnemonic);

    await keystore.rekeySecondFactor(pin);

    expect(keystore.serverAuthToken()).toBe(tokenVector.server_auth_token_hex);
  });

  it('propagates the vault outcome without unlocking on a wrong PIN', async () => {
    const storage = memoryStorage();
    await createSeedVault(mnemonic, pin, storage);
    const keystore = new SessionKeystore({ storage, idleTimeoutMs: 0 });

    expect(await keystore.unlock('428194')).toEqual({
      status: 'invalid-pin',
      attemptsRemaining: 2,
    });
    expect(keystore.isUnlocked).toBe(false);
    expect(() => keystore.userAddress).toThrow(/locked/);
  });

  it('reports a missing vault', async () => {
    const keystore = new SessionKeystore({ storage: memoryStorage(), idleTimeoutMs: 0 });
    expect(await keystore.unlock(pin)).toEqual({ status: 'no-vault' });
  });
});

describe('locking zeroes key material', () => {
  it('zeroes every private value it held and refuses access afterwards', async () => {
    const { keystore } = await unlockedKeystore();

    const identity = keystore.identityPrivateKey;
    const x25519 = keystore.x25519PrivateKey;
    const mlkem = keystore.mlkem768SecretKey;

    keystore.lock();

    expect(bytesToHex(identity)).toBe('00'.repeat(identity.length));
    expect(bytesToHex(x25519)).toBe('00'.repeat(x25519.length));
    expect(bytesToHex(mlkem)).toBe('00'.repeat(mlkem.length));

    expect(keystore.isUnlocked).toBe(false);
    expect(() => keystore.identityPrivateKey).toThrow(/locked/);
    expect(() => keystore.serverAuthToken()).toThrow(/locked/);
  });

  it('notifies lock listeners exactly once per lock', async () => {
    const { keystore } = await unlockedKeystore();
    const listener = vi.fn();
    keystore.onLock(listener);

    keystore.lock();
    keystore.lock();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', async () => {
    const { keystore } = await unlockedKeystore();
    const listener = vi.fn();
    keystore.onLock(listener)();

    keystore.lock();
    expect(listener).not.toHaveBeenCalled();
  });

  it('zeroes the previous session when unlocked again', async () => {
    const { keystore } = await unlockedKeystore();
    const firstIdentity = keystore.identityPrivateKey;

    await keystore.unlock(pin);

    expect(bytesToHex(firstIdentity)).toBe('00'.repeat(firstIdentity.length));
    expect(bytesToHex(keystore.identityPrivateKey)).toBe(identityVector.private_key_hex);
  });
});

describe('idle timeout', () => {
  it('locks after the idle window and re-arms on each access', async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      await createSeedVault(mnemonic, pin, storage);
      const keystore = new SessionKeystore({ storage, idleTimeoutMs: 1000 });
      await keystore.unlock(pin);

      vi.advanceTimersByTime(900);
      expect(keystore.userAddress).toBe(userAddress);

      vi.advanceTimersByTime(900);
      expect(keystore.isUnlocked).toBe(true);

      vi.advanceTimersByTime(1100);
      expect(keystore.isUnlocked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('storage discipline', () => {
  it('writes nothing beyond the PIN-wrapped vault record', async () => {
    const { storage } = await unlockedKeystore();
    const keys = storage.entries().map(([key]) => key);
    expect(keys).toEqual([SEED_VAULT_STORAGE_KEY]);

    const serialized = storage.entries().map(([, value]) => value).join('');
    expect(serialized).not.toContain(pin);
    expect(serialized).not.toContain(tokenVector.server_auth_token_hex);
    expect(serialized).not.toContain(identityVector.private_key_hex);
    expect(serialized).not.toContain('abandon');
  });
});
