import { describe, expect, it } from 'vitest';
import {
  MalformedManifestError,
  ManifestLayoutError,
  assertManifestMatchesRow,
  buildManifest,
  openManifest,
  sealManifest,
} from './manifest';
import { CHUNK_PAYLOAD_BYTES, CHUNK_STRIDE_BYTES, layoutFor } from './layout';

const DEK = new Uint8Array(32).fill(3);
const OTHER_DEK = new Uint8Array(32).fill(4);
const AT = new Date('2026-09-09T10:14:22.000Z');

describe('building a manifest', () => {
  it('records the true plaintext length, not the padded one', () => {
    const manifest = buildManifest('passport-scan.pdf', 'application/pdf', 2_483_911, AT);

    expect(manifest.size).toBe(2_483_911);
    expect(manifest.size).toBeLessThan(layoutFor(2_483_911).storedBytes);
  });

  it('carries the chunk layout the object was built with', () => {
    const manifest = buildManifest('clip.mp4', 'video/mp4', CHUNK_PAYLOAD_BYTES * 2 + 5, AT);

    expect(manifest.chunk_size).toBe(CHUNK_PAYLOAD_BYTES);
    expect(manifest.chunk_count).toBe(3);
  });

  it('has no thumbnail until one is derived', () => {
    expect(buildManifest('a.txt', 'text/plain', 10, AT).thumbnail_id).toBeUndefined();
  });
});

describe('sealing a manifest', () => {
  it('round-trips under the file DEK', async () => {
    const manifest = buildManifest('passport-scan.pdf', 'application/pdf', 2_483_911, AT);
    const sealed = await sealManifest(manifest, DEK);

    expect(await openManifest(sealed, DEK)).toEqual(manifest);
  });

  it('is base64, because it is a ciphertext column and not an object', async () => {
    const sealed = await sealManifest(buildManifest('a.txt', 'text/plain', 10, AT), DEK);

    expect(typeof sealed).toBe('string');
    expect(sealed).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('does not open under another file DEK', async () => {
    const sealed = await sealManifest(buildManifest('a.txt', 'text/plain', 10, AT), DEK);

    await expect(openManifest(sealed, OTHER_DEK)).rejects.toThrow();
  });

  it('never puts the filename anywhere but the ciphertext', async () => {
    const sealed = await sealManifest(buildManifest('passport.pdf', 'application/pdf', 10, AT), DEK);

    expect(sealed).not.toContain('passport');
  });

  it('refuses a payload that decrypts but is not a manifest', async () => {
    const { sealText } = await import('@/lib/sealed');

    await expect(openManifest(await sealText('null', DEK), DEK)).rejects.toThrow(
      MalformedManifestError,
    );
    await expect(openManifest(await sealText('not json', DEK), DEK)).rejects.toThrow(
      MalformedManifestError,
    );
    await expect(
      openManifest(await sealText(JSON.stringify({ name: 'a' }), DEK), DEK),
    ).rejects.toThrow(MalformedManifestError);
  });

  it('refuses a manifest whose size is not a whole number', async () => {
    const { sealText } = await import('@/lib/sealed');
    const broken = { ...buildManifest('a.txt', 'text/plain', 10, AT), size: 1.5 };

    await expect(openManifest(await sealText(JSON.stringify(broken), DEK), DEK)).rejects.toThrow(
      MalformedManifestError,
    );
  });
});

describe('checking a manifest against its ledger row', () => {
  it('accepts a row that describes the same object', () => {
    const manifest = buildManifest('a.pdf', 'application/pdf', 2_483_911, AT);
    const layout = layoutFor(2_483_911);

    expect(() =>
      assertManifestMatchesRow(manifest, layout.storedBytes),
    ).not.toThrow();
  });

  it('accepts a small file, which the old formula would have refused', () => {
    const manifest = buildManifest('note.txt', 'text/plain', 40_000, AT);

    expect(() => assertManifestMatchesRow(manifest, 65_573)).not.toThrow();
    expect(() =>
      assertManifestMatchesRow(manifest, CHUNK_STRIDE_BYTES),
    ).toThrow(ManifestLayoutError);
  });

  it('refuses a row whose stored size disagrees', () => {
    const manifest = buildManifest('a.pdf', 'application/pdf', 2_483_911, AT);
    const layout = layoutFor(2_483_911);

    expect(() =>
      assertManifestMatchesRow(manifest, layout.storedBytes + 64),
    ).toThrow(ManifestLayoutError);
  });

  it('takes the chunk layout from the manifest, because the row does not carry one', () => {
    const manifest = buildManifest('a.pdf', 'application/pdf', 2_483_911, AT);
    const layout = layoutFor(2_483_911);

    expect(() => assertManifestMatchesRow(manifest, layout.storedBytes)).not.toThrow();
    expect(Object.keys(manifest)).toContain('chunk_count');
  });

  it('refuses a manifest whose own chunk count contradicts its size', () => {
    const manifest = { ...buildManifest('a.pdf', 'application/pdf', 2_483_911, AT), chunk_count: 4 };
    const layout = layoutFor(2_483_911);

    expect(() => assertManifestMatchesRow(manifest, layout.storedBytes)).toThrow(
      ManifestLayoutError,
    );
  });

  it('refuses a manifest written with a different chunk size', () => {
    const manifest = { ...buildManifest('a.pdf', 'application/pdf', 40_000, AT), chunk_size: 1 << 20 };

    expect(() => assertManifestMatchesRow(manifest, 65_573)).toThrow(ManifestLayoutError);
  });

  it('reads as a data error, not as a security alert', () => {
    const manifest = buildManifest('a.pdf', 'application/pdf', 2_483_911, AT);
    const layout = layoutFor(2_483_911);

    try {
      assertManifestMatchesRow(manifest, layout.storedBytes + 1);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toContain('fault in the upload');
      expect(message.toLowerCase()).not.toContain('attack');
      expect(message.toLowerCase()).not.toContain('tamper');
    }
  });
});
