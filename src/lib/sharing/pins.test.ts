import { describe, expect, it } from 'vitest';
import { vaultKekDekWrapper } from '@/lib/secrets';
import {
  FINGERPRINT_PINS_STORAGE_KEY,
  LEGACY_FINGERPRINT_PIN_PREFIX,
  pinFingerprint,
  readFingerprintPin,
  readFingerprintPins,
  sealLegacyFingerprintPins,
  wipeFingerprintPins,
  type PinStorage,
} from './pins';

const CONNECTION = '0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e';
const OTHER_CONNECTION = '5b1d7e2a-3c4f-4a6b-9d8e-1f2a3b4c5d6e';
const FINGERPRINT = 'A1B2-C3D4-E5F6-A7B8-C9D0-E1F2';

function memoryStorage(initial: Record<string, string> = {}): PinStorage & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

function accountWrapper() {
  return vaultKekDekWrapper(crypto.getRandomValues(new Uint8Array(32)));
}

describe('fingerprint pins', () => {
  it('reads back what was pinned', async () => {
    const storage = memoryStorage();
    const wrapper = accountWrapper();

    await pinFingerprint(CONNECTION, FINGERPRINT, { wrapper, storage });

    await expect(readFingerprintPin(CONNECTION, { wrapper, storage })).resolves.toBe(FINGERPRINT);
    await expect(readFingerprintPin(OTHER_CONNECTION, { wrapper, storage })).resolves.toBeUndefined();
  });

  it('stores neither the connection nor the fingerprint in readable form', async () => {
    const storage = memoryStorage();

    await pinFingerprint(CONNECTION, FINGERPRINT, { wrapper: accountWrapper(), storage });

    const stored = [...storage.entries.entries()].flat().join('\n');
    expect(storage.entries.size).toBe(1);
    expect(stored).not.toContain(CONNECTION);
    expect(stored).not.toContain(FINGERPRINT);
  });

  it('opens nothing, and throws nothing, under another account', async () => {
    const storage = memoryStorage();
    await pinFingerprint(CONNECTION, FINGERPRINT, { wrapper: accountWrapper(), storage });

    await expect(readFingerprintPins({ wrapper: accountWrapper(), storage })).resolves.toEqual({});
  });

  it('keeps both pins when two connections are accepted at once', async () => {
    const storage = memoryStorage();
    const wrapper = accountWrapper();

    await Promise.all([
      pinFingerprint(CONNECTION, FINGERPRINT, { wrapper, storage }),
      pinFingerprint(OTHER_CONNECTION, 'FFFF-EEEE-DDDD-CCCC-BBBB-AAAA', { wrapper, storage }),
    ]);

    await expect(readFingerprintPins({ wrapper, storage })).resolves.toEqual({
      [CONNECTION]: FINGERPRINT,
      [OTHER_CONNECTION]: 'FFFF-EEEE-DDDD-CCCC-BBBB-AAAA',
    });
  });

  it('seals a plaintext pin left by the earlier version and deletes the original', async () => {
    const storage = memoryStorage({ [LEGACY_FINGERPRINT_PIN_PREFIX + CONNECTION]: FINGERPRINT });
    const wrapper = accountWrapper();

    await expect(readFingerprintPin(CONNECTION, { wrapper, storage })).resolves.toBe(FINGERPRINT);

    expect([...storage.entries.keys()]).toEqual([FINGERPRINT_PINS_STORAGE_KEY]);
    await expect(readFingerprintPin(CONNECTION, { wrapper, storage })).resolves.toBe(FINGERPRINT);
  });

  it('prefers the sealed pin over a plaintext one for the same connection', async () => {
    const storage = memoryStorage();
    const wrapper = accountWrapper();
    await pinFingerprint(CONNECTION, FINGERPRINT, { wrapper, storage });
    storage.setItem(LEGACY_FINGERPRINT_PIN_PREFIX + CONNECTION, 'SWAP-PEDX-XXXX-XXXX-XXXX-XXXX');

    await expect(readFingerprintPin(CONNECTION, { wrapper, storage })).resolves.toBe(FINGERPRINT);
  });

  it('never replaces a pin that already stands, and reports the one that does', async () => {
    const storage = memoryStorage();
    const wrapper = accountWrapper();
    await pinFingerprint(CONNECTION, FINGERPRINT, { wrapper, storage });

    await expect(
      pinFingerprint(CONNECTION, 'SWAP-PEDX-XXXX-XXXX-XXXX-XXXX', { wrapper, storage }),
    ).resolves.toBe(FINGERPRINT);
    await expect(readFingerprintPin(CONNECTION, { wrapper, storage })).resolves.toBe(FINGERPRINT);
  });

  it('seals plaintext pins at unlock, without waiting for an invitation to be reviewed', async () => {
    const storage = memoryStorage({ [LEGACY_FINGERPRINT_PIN_PREFIX + CONNECTION]: FINGERPRINT });
    const wrapper = accountWrapper();

    await sealLegacyFingerprintPins({ wrapper, storage });

    expect([...storage.entries.keys()]).toEqual([FINGERPRINT_PINS_STORAGE_KEY]);
    await expect(readFingerprintPin(CONNECTION, { wrapper, storage })).resolves.toBe(FINGERPRINT);
  });

  it('writes nothing at unlock when there is nothing to seal', async () => {
    const storage = memoryStorage();

    await sealLegacyFingerprintPins({ wrapper: accountWrapper(), storage });

    expect(storage.entries.size).toBe(0);
  });

  it('treats a damaged record as no pins', async () => {
    const storage = memoryStorage({ [FINGERPRINT_PINS_STORAGE_KEY]: '{not json' });

    await expect(readFingerprintPins({ wrapper: accountWrapper(), storage })).resolves.toEqual({});
  });

  it('wipes the sealed record and any plaintext leftovers', async () => {
    const storage = memoryStorage({ [LEGACY_FINGERPRINT_PIN_PREFIX + OTHER_CONNECTION]: FINGERPRINT });
    await pinFingerprint(CONNECTION, FINGERPRINT, { wrapper: accountWrapper(), storage });
    storage.setItem(LEGACY_FINGERPRINT_PIN_PREFIX + CONNECTION, FINGERPRINT);
    storage.setItem('encrypted_seed', 'kept');

    wipeFingerprintPins(storage);

    expect([...storage.entries.keys()]).toEqual(['encrypted_seed']);
  });
});
