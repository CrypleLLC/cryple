import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToHex } from '@/lib/encoding';
import { UnsupportedSealedVersionError } from '@/lib/sealed';
import {
  buildRecoveryVault,
  combineSecret,
  decryptSeedPhrase,
  effectiveQuorum,
  encryptSeedPhrase,
  generateRek,
  recoverSeedPhrase,
  requiresSoleGuardianWarning,
  shareCountForGuardians,
  splitSecret,
  ThresholdError,
  validateSplitConfig,
  MAX_SHARES,
  REK_LENGTH,
  USER_SHARE_INDEX,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;

function everyCombination<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  return [
    ...everyCombination(rest, size - 1).map((combo) => [head, ...combo]),
    ...everyCombination(rest, size),
  ];
}

describe('the REK', () => {
  it('is a random 256-bit key, not derived from the seed', () => {
    const a = generateRek();
    const b = generateRek();
    expect(a).toHaveLength(REK_LENGTH);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('encrypts the seed phrase and decrypts it back', async () => {
    const rek = generateRek();
    const encrypted = await encryptSeedPhrase(mnemonic, rek);

    expect(encrypted).not.toContain('abandon');
    expect(await decryptSeedPhrase(encrypted, rek)).toBe(mnemonic);
  });

  it('refuses to seal something that is not a valid mnemonic', async () => {
    await expect(encryptSeedPhrase('not a real phrase', generateRek())).rejects.toThrow(
      /invalid mnemonic/,
    );
  });

  it('fails loudly under the wrong REK rather than returning garbage', async () => {
    const encrypted = await encryptSeedPhrase(mnemonic, generateRek());
    await expect(decryptSeedPhrase(encrypted, generateRek())).rejects.toThrow();
  });

  it('rejects an unknown envelope version instead of guessing', async () => {
    const rek = generateRek();
    const blob = Uint8Array.from(atob(await encryptSeedPhrase(mnemonic, rek)), (c) =>
      c.charCodeAt(0),
    );
    blob[0] = 0x02;
    await expect(
      decryptSeedPhrase(btoa(String.fromCharCode(...blob)), rek),
    ).rejects.toThrow(UnsupportedSealedVersionError);
  });
});

describe('share counting — n = guardians + 1', () => {
  it('always counts the user’s own Recovery Kit copy', () => {
    expect(shareCountForGuardians(0)).toBe(1);
    expect(shareCountForGuardians(2)).toBe(3);
  });

  it('reserves index 0 for the user’s own copy', async () => {
    const { shares } = await buildRecoveryVault(mnemonic, { shares: 3, threshold: 2 });
    expect(shares[0].shareIndex).toBe(USER_SHARE_INDEX);
    expect(shares.map((s) => s.shareIndex)).toEqual([0, 1, 2]);
  });

  it('reports the effective quorum as min(configured, active guardians)', () => {
    expect(effectiveQuorum(3, 2)).toBe(2);
    expect(effectiveQuorum(2, 5)).toBe(2);
  });
});

describe('threshold validation — the API’s only rule is 1 <= k <= n', () => {
  it('accepts the recommended 2-of-3', () => {
    expect(() => validateSplitConfig({ shares: 3, threshold: 2 })).not.toThrow();
  });

  it('accepts k equal to n', () => {
    expect(() => validateSplitConfig({ shares: 3, threshold: 3 })).not.toThrow();
  });

  it('rejects k greater than n', () => {
    expect(() => validateSplitConfig({ shares: 2, threshold: 3 })).toThrow(ThresholdError);
  });

  it('rejects a zero or negative threshold', () => {
    expect(() => validateSplitConfig({ shares: 3, threshold: 0 })).toThrow(ThresholdError);
    expect(() => validateSplitConfig({ shares: 3, threshold: -1 })).toThrow(ThresholdError);
  });

  it('rejects a share count outside the GF(256) range', () => {
    expect(() => validateSplitConfig({ shares: 0, threshold: 1 })).toThrow(ThresholdError);
    expect(() => validateSplitConfig({ shares: MAX_SHARES + 1, threshold: 2 })).toThrow(
      ThresholdError,
    );
  });

  it('flags the k=1 configuration that needs the sole-guardian warning', () => {
    expect(requiresSoleGuardianWarning({ shares: 2, threshold: 1 })).toBe(true);
    expect(requiresSoleGuardianWarning({ shares: 3, threshold: 1 })).toBe(true);
    expect(requiresSoleGuardianWarning({ shares: 3, threshold: 2 })).toBe(false);
    expect(requiresSoleGuardianWarning({ shares: 1, threshold: 1 })).toBe(false);
  });
});

describe('splitting and reconstructing the REK', () => {
  it('produces n shares of the documented layout — secret bytes plus one x byte', async () => {
    const shares = await splitSecret(generateRek(), { shares: 3, threshold: 2 });
    expect(shares).toHaveLength(3);
    for (const { bytes } of shares) {
      expect(bytes).toHaveLength(REK_LENGTH + 1);
    }
  });

  it('gives every share a distinct x-coordinate', async () => {
    const shares = await splitSecret(generateRek(), { shares: 5, threshold: 3 });
    const coordinates = shares.map(({ bytes }) => bytes[bytes.length - 1]);
    expect(new Set(coordinates).size).toBe(5);
    expect(coordinates).not.toContain(0);
  });

  it('reconstructs from any k of n — the default 2-of-3', async () => {
    const rek = generateRek();
    const shares = await splitSecret(rek, { shares: 3, threshold: 2 });

    for (const pair of everyCombination(shares, 2)) {
      const combined = await combineSecret(pair.map((s) => s.bytes));
      expect(bytesToHex(combined)).toBe(bytesToHex(rek));
    }
  });

  it('reconstructs from any 3 of 5', async () => {
    const rek = generateRek();
    const shares = await splitSecret(rek, { shares: 5, threshold: 3 });

    for (const triple of everyCombination(shares, 3)) {
      expect(bytesToHex(await combineSecret(triple.map((s) => s.bytes)))).toBe(
        bytesToHex(rek),
      );
    }
  });

  it('yields the wrong REK below the threshold — which then fails at seed decryption', async () => {
    const rek = generateRek();
    const encrypted = await encryptSeedPhrase(mnemonic, rek);
    const shares = await splitSecret(rek, { shares: 3, threshold: 3 });

    const short = await combineSecret(shares.slice(0, 2).map((s) => s.bytes));
    expect(bytesToHex(short)).not.toBe(bytesToHex(rek));
    await expect(decryptSeedPhrase(encrypted, short)).rejects.toThrow();
  });

  it('is order-independent', async () => {
    const rek = generateRek();
    const shares = await splitSecret(rek, { shares: 3, threshold: 2 });
    const [a, b] = shares;

    expect(bytesToHex(await combineSecret([a.bytes, b.bytes]))).toBe(
      bytesToHex(await combineSecret([b.bytes, a.bytes])),
    );
  });
});

describe('k=1 — the degenerate degree-0 case', () => {
  it('lets any single share reconstruct on its own', async () => {
    const rek = generateRek();
    const shares = await splitSecret(rek, { shares: 3, threshold: 1 });

    for (const { bytes } of shares) {
      expect(bytesToHex(await combineSecret([bytes]))).toBe(bytesToHex(rek));
    }
  });

  it('emits the same share layout as the library does at higher degrees', async () => {
    const rek = generateRek();
    const degenerate = await splitSecret(rek, { shares: 3, threshold: 1 });
    const ordinary = await splitSecret(rek, { shares: 3, threshold: 2 });

    for (let i = 0; i < 3; i++) {
      expect(degenerate[i].bytes).toHaveLength(ordinary[i].bytes.length);
    }
  });

  it('carries the secret verbatim, as a degree-0 polynomial must', async () => {
    const rek = generateRek();
    const [first] = await splitSecret(rek, { shares: 2, threshold: 1 });
    expect(bytesToHex(first.bytes.slice(0, REK_LENGTH))).toBe(bytesToHex(rek));
  });

  it('still gives each share a distinct x-coordinate so combine accepts them', async () => {
    const shares = await splitSecret(generateRek(), { shares: 4, threshold: 1 });
    const coordinates = shares.map(({ bytes }) => bytes[bytes.length - 1]);
    expect(new Set(coordinates).size).toBe(4);
  });

  it('handles n=1 — the user’s own copy with no guardians', async () => {
    const rek = generateRek();
    const shares = await splitSecret(rek, { shares: 1, threshold: 1 });
    expect(shares).toHaveLength(1);
    expect(bytesToHex(await combineSecret([shares[0].bytes]))).toBe(bytesToHex(rek));
  });

  it('rejects combining nothing', async () => {
    await expect(combineSecret([])).rejects.toThrow(ThresholdError);
  });
});

describe('the whole vault round-trips', () => {
  it('rebuilds the seed phrase from the user’s copy plus one guardian', async () => {
    const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, {
      shares: 3,
      threshold: 2,
    });

    const recovered = await recoverSeedPhrase(encryptedSeed, [
      shares[0].bytes,
      shares[2].bytes,
    ]);
    expect(recovered).toBe(mnemonic);
  });

  it('rebuilds from two guardians without the user’s copy', async () => {
    const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, {
      shares: 3,
      threshold: 2,
    });

    expect(await recoverSeedPhrase(encryptedSeed, [shares[1].bytes, shares[2].bytes])).toBe(
      mnemonic,
    );
  });

  it('never leaves the phrase or the REK in the encrypted blob', async () => {
    const { encryptedSeed } = await buildRecoveryVault(mnemonic, {
      shares: 3,
      threshold: 2,
    });
    expect(encryptedSeed).not.toContain('abandon');
    expect(atob(encryptedSeed)).not.toContain('abandon');
  });

  it('produces a different vault every time for the same phrase', async () => {
    const first = await buildRecoveryVault(mnemonic, { shares: 3, threshold: 2 });
    const second = await buildRecoveryVault(mnemonic, { shares: 3, threshold: 2 });
    expect(first.encryptedSeed).not.toBe(second.encryptedSeed);
  });

  it('refuses an invalid configuration before generating anything', async () => {
    await expect(buildRecoveryVault(mnemonic, { shares: 2, threshold: 5 })).rejects.toThrow(
      ThresholdError,
    );
  });
});
