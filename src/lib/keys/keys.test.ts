import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import {
  bytesToHex,
  hexToBytes,
  uncompressedPointToXY,
  spkiBase64ToUncompressedPoint,
  P256_SPKI_BASE64_LENGTH,
} from '@/lib/encoding';
import {
  deriveKeyTreeFromSeed,
  deriveUserAddress,
  deriveVaultKek,
  IDENTITY_PATH,
  MLKEM768_HKDF_INFO,
  VAULT_KEK_HKDF_INFO,
  X25519_HKDF_INFO,
} from './index';
import { mnemonicToSeed, isValidMnemonic } from './mnemonic';
import { SLIP10_P256_CURVE_NAME } from './slip10';

const seedVector = vectors.seed_and_user_address;
const identityVector = vectors.identity_key_p256;
const x25519Vector = vectors.x25519_key;
const mlkemVector = vectors.mlkem768_key;
const vaultKekVector = vectors.vault_kek;

describe('the fixture pins the constants this client must not diverge on', () => {
  it('matches the frozen SLIP-0010 HMAC key and derivation path', () => {
    expect(identityVector.slip10_hmac_key).toBe(SLIP10_P256_CURVE_NAME);
    expect(identityVector.path).toBe(
      `m/${IDENTITY_PATH.map((index) => `${index}'`).join('/')}`,
    );
  });

  it('matches the frozen HKDF info labels', () => {
    expect(x25519Vector.hkdf_info_label).toBe(X25519_HKDF_INFO);
    expect(mlkemVector.hkdf_info_label).toBe(MLKEM768_HKDF_INFO);
    expect(vaultKekVector.hkdf_info_label).toBe(VAULT_KEK_HKDF_INFO);
  });
});

describe('mnemonic to seed (BIP39)', () => {
  it('reproduces the vector seed', async () => {
    const seed = await mnemonicToSeed(seedVector.mnemonic, seedVector.passphrase);
    expect(bytesToHex(seed)).toBe(seedVector.seed_hex);
  });

  it('rejects a mnemonic with a broken checksum', async () => {
    const broken = seedVector.mnemonic.replace(/about$/, 'abandon');
    expect(isValidMnemonic(broken)).toBe(false);
    await expect(mnemonicToSeed(broken)).rejects.toThrow(/invalid mnemonic/);
  });

  it('rejects unsupported word counts', () => {
    expect(isValidMnemonic('abandon abandon abandon')).toBe(false);
  });

  it('derives a different seed under a passphrase', async () => {
    const seed = await mnemonicToSeed(seedVector.mnemonic, 'not-the-default');
    expect(bytesToHex(seed)).not.toBe(seedVector.seed_hex);
  });
});

describe('user_address', () => {
  it('hashes the 64 raw seed bytes, not the hex string', async () => {
    const seed = hexToBytes(seedVector.seed_hex);
    expect(await deriveUserAddress(seed)).toBe(seedVector.user_address);
  });

  it('differs from SHA-256 of the seed hex string — the known obsolete-client bug', async () => {
    const seed = hexToBytes(seedVector.seed_hex);
    const hashedHexString = bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seedVector.seed_hex)),
      ),
    );
    expect(hashedHexString).not.toBe(seedVector.user_address);
    expect(await deriveUserAddress(seed)).toBe(seedVector.user_address);
  });
});

describe('the frozen key tree reproduces test-vectors.json end to end', () => {
  const treePromise = (async () => {
    const seed = await mnemonicToSeed(seedVector.mnemonic, seedVector.passphrase);
    return deriveKeyTreeFromSeed(seed);
  })();

  it('reproduces the seed and user_address', async () => {
    const tree = await treePromise;
    expect(bytesToHex(tree.seed)).toBe(seedVector.seed_hex);
    expect(tree.userAddress).toBe(seedVector.user_address);
  });

  it('reproduces the P-256 identity private key and chain code', async () => {
    const tree = await treePromise;
    expect(bytesToHex(tree.identity.privateKey)).toBe(identityVector.private_key_hex);
    expect(bytesToHex(tree.identity.chainCode)).toBe(identityVector.chain_code_hex);
  });

  it('reproduces the P-256 public key in all three encodings', async () => {
    const tree = await treePromise;

    expect(bytesToHex(tree.identity.publicKeyUncompressed)).toBe(
      identityVector.public_key_uncompressed_hex,
    );
    expect(tree.identity.publicKeySpkiBase64).toBe(identityVector.public_key_spki_base64);
    expect(tree.identity.publicKeySpkiBase64).toHaveLength(P256_SPKI_BASE64_LENGTH);

    const { x, y } = uncompressedPointToXY(tree.identity.publicKeyUncompressed);
    expect(bytesToHex(x)).toBe(identityVector.onchain_pubkey_x_hex);
    expect(bytesToHex(y)).toBe(identityVector.onchain_pubkey_y_hex);
  });

  it('reproduces the X25519 key pair', async () => {
    const tree = await treePromise;
    expect(bytesToHex(tree.x25519.privateKey)).toBe(x25519Vector.private_key_or_seed_hex);
    expect(bytesToHex(tree.x25519.publicKey)).toBe(x25519Vector.public_key_hex);
    expect(tree.x25519.publicKeyBase64).toBe(x25519Vector.public_key_base64);
  });

  it('reproduces the ML-KEM-768 key pair', async () => {
    const tree = await treePromise;
    expect(bytesToHex(tree.mlkem768.seed)).toBe(mlkemVector.private_key_or_seed_hex);
    expect(bytesToHex(tree.mlkem768.publicKey)).toBe(mlkemVector.public_key_hex);
    expect(tree.mlkem768.publicKeyBase64).toBe(mlkemVector.public_key_base64);
    expect(tree.mlkem768.publicKey).toHaveLength(1184);
  });

  it('reproduces the vault KEK', async () => {
    const tree = await treePromise;
    expect(bytesToHex(tree.vaultKek)).toBe(vaultKekVector.vault_kek_hex);
    expect(bytesToHex(tree.vaultKek)).toHaveLength(64);
  });

});

describe('vault KEK derivation', () => {
  it('matches the vector via deriveVaultKek directly', async () => {
    const seed = hexToBytes(seedVector.seed_hex);
    expect(bytesToHex(await deriveVaultKek(seed))).toBe(vaultKekVector.vault_kek_hex);
  });
});

describe('determinism and domain separation', () => {
  it('derives identical material from the same seed twice', async () => {
    const seed = hexToBytes(seedVector.seed_hex);
    const a = await deriveKeyTreeFromSeed(seed);
    const b = await deriveKeyTreeFromSeed(seed);

    expect(bytesToHex(a.identity.privateKey)).toBe(bytesToHex(b.identity.privateKey));
    expect(bytesToHex(a.x25519.privateKey)).toBe(bytesToHex(b.x25519.privateKey));
    expect(bytesToHex(a.mlkem768.publicKey)).toBe(bytesToHex(b.mlkem768.publicKey));
  });

  it('keeps the three HKDF leaves independent', async () => {
    const tree = await deriveKeyTreeFromSeed(hexToBytes(seedVector.seed_hex));
    expect(bytesToHex(tree.x25519.privateKey)).not.toBe(
      bytesToHex(tree.mlkem768.seed.slice(0, 32)),
    );
    expect(bytesToHex(tree.vaultKek)).not.toBe(bytesToHex(tree.x25519.privateKey));
    expect(bytesToHex(tree.vaultKek)).not.toBe(bytesToHex(tree.mlkem768.seed.slice(0, 32)));
  });

  it('round-trips the SPKI encoding back to the uncompressed point', async () => {
    const tree = await deriveKeyTreeFromSeed(hexToBytes(seedVector.seed_hex));
    const recovered = spkiBase64ToUncompressedPoint(tree.identity.publicKeySpkiBase64);
    expect(bytesToHex(recovered)).toBe(identityVector.public_key_uncompressed_hex);
  });
});
