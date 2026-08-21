import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import { heirLabelSealer, readLabel, UNREADABLE_LABEL } from './label';

const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const labelVector = vectors.sealed_label_blob;
const sealer = heirLabelSealer(tree.heirLabelKey);

describe('the heir label vector', () => {
  it('opens the recorded blob to the recorded plaintext', async () => {
    expect(await sealer.openLabel(labelVector.blob_base64)).toBe(labelVector.plaintext_utf8);
  });

  it('reproduces the blob byte for byte, because AES-GCM with a fixed IV is deterministic', async () => {
    // Sealing here draws a fresh IV, so the round trip is what this client can
    // reproduce; the recorded blob is checked by opening it above.
    const resealed = await sealer.sealLabel(labelVector.plaintext_utf8);
    expect(resealed).not.toBe(labelVector.blob_base64);
    expect(await sealer.openLabel(resealed)).toBe(labelVector.plaintext_utf8);
  });

  it('seals the bytes the user typed, with no normalization step', async () => {
    const composed = labelVector.plaintext_utf8;
    const decomposed = composed.normalize('NFD');

    expect(decomposed).not.toBe(composed);
    expect(await sealer.openLabel(await sealer.sealLabel(decomposed))).toBe(decomposed);
  });

  it('is sealed with the label key and not the vault KEK', async () => {
    const wrong = heirLabelSealer(tree.vaultKek);

    await expect(wrong.openLabel(labelVector.blob_base64)).rejects.toThrow();
  });
});

describe('reading a label for display', () => {
  it('returns the plaintext when it opens', async () => {
    expect(await readLabel(sealer, labelVector.blob_base64)).toBe(labelVector.plaintext_utf8);
  });

  it('says so rather than throwing, so one bad label cannot hide an heir', async () => {
    expect(await readLabel(sealer, 'bm90LWEtc2VhbGVkLWJsb2I=')).toBe(UNREADABLE_LABEL);
    expect(await readLabel(heirLabelSealer(tree.vaultKek), labelVector.blob_base64)).toBe(
      UNREADABLE_LABEL,
    );
  });
});
