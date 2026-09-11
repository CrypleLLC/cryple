import { describe, expect, it } from 'vitest';
import { ChunkPositionError, chunkIv, openChunk, sealChunk, sealedChunkLength } from './chunks';
import { CHUNK_OVERHEAD_BYTES } from './layout';
import { MalformedSealedBlobError, UnsupportedSealedVersionError } from '@/lib/sealed';
import { concatBytes } from '@/lib/encoding';

const DEK = new Uint8Array(32).fill(7);
const OTHER_DEK = new Uint8Array(32).fill(9);

function payload(length: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * seed + 13) % 251);
}

describe('sealing a chunk', () => {
  it('round-trips at its own position', async () => {
    const bytes = payload(1024);
    const sealed = await sealChunk(bytes, 2, 5, DEK);

    expect(await openChunk(sealed, 2, 5, DEK)).toEqual(bytes);
  });

  it('costs exactly 37 bytes over its payload', async () => {
    for (const length of [0, 1, 1024, 65_536]) {
      const sealed = await sealChunk(payload(length), 0, 1, DEK);

      expect(sealed.length).toBe(length + CHUNK_OVERHEAD_BYTES);
      expect(sealed.length).toBe(sealedChunkLength(length));
    }
  });

  it('carries the frozen envelope version byte', async () => {
    const sealed = await sealChunk(payload(16), 0, 1, DEK);

    expect(sealed[0]).toBe(0x01);
  });

  it('is raw bytes, not base64', async () => {
    const sealed = await sealChunk(payload(256), 0, 1, DEK);

    expect(sealed).toBeInstanceOf(Uint8Array);
    expect(sealed.length).toBeLessThan(256 * 1.34);
  });

  it('seals an empty payload, because a padded object never has one but the format allows it', async () => {
    const sealed = await sealChunk(new Uint8Array(0), 0, 1, DEK);

    expect(await openChunk(sealed, 0, 1, DEK)).toEqual(new Uint8Array(0));
  });

  it('refuses a position the object cannot have', async () => {
    await expect(sealChunk(payload(8), 3, 3, DEK)).rejects.toThrow(RangeError);
    await expect(sealChunk(payload(8), -1, 3, DEK)).rejects.toThrow(RangeError);
    await expect(sealChunk(payload(8), 0, 0, DEK)).rejects.toThrow(RangeError);
  });
});

describe('the position header is what makes reordering detectable', () => {
  it('refuses a chunk read at the wrong index', async () => {
    const sealed = await sealChunk(payload(64), 1, 4, DEK);

    await expect(openChunk(sealed, 2, 4, DEK)).rejects.toThrow(ChunkPositionError);
  });

  it('refuses a chunk whose object had a different length', async () => {
    const sealed = await sealChunk(payload(64), 1, 4, DEK);

    await expect(openChunk(sealed, 1, 3, DEK)).rejects.toThrow(ChunkPositionError);
  });

  it('reports both what it expected and what it found', async () => {
    const sealed = await sealChunk(payload(64), 1, 4, DEK);

    await expect(openChunk(sealed, 0, 4, DEK)).rejects.toMatchObject({
      expected: { index: 0, count: 4 },
      found: { index: 1, count: 4 },
    });
  });

  it('detects two chunks of one object swapped with each other', async () => {
    const first = await sealChunk(payload(64, 1), 0, 2, DEK);
    const second = await sealChunk(payload(64, 2), 1, 2, DEK);

    await expect(openChunk(second, 0, 2, DEK)).rejects.toThrow(ChunkPositionError);
    await expect(openChunk(first, 1, 2, DEK)).rejects.toThrow(ChunkPositionError);
  });
});

describe('the tag is what makes substitution detectable', () => {
  it('refuses a chunk spliced in from a file with a different DEK', async () => {
    const sealed = await sealChunk(payload(64), 0, 1, OTHER_DEK);

    await expect(openChunk(sealed, 0, 1, DEK)).rejects.toThrow();
  });

  it('refuses a chunk whose ciphertext was altered', async () => {
    const sealed = await sealChunk(payload(64), 0, 1, DEK);
    sealed[20] ^= 0xff;

    await expect(openChunk(sealed, 0, 1, DEK)).rejects.toThrow();
  });

  it('refuses a chunk whose position header was altered', async () => {
    const sealed = await sealChunk(payload(64), 0, 2, DEK);
    sealed[13] ^= 0xff;

    await expect(openChunk(sealed, 0, 2, DEK)).rejects.toThrow();
  });

  it('refuses a truncated chunk', async () => {
    const sealed = await sealChunk(payload(64), 0, 1, DEK);

    await expect(openChunk(sealed.subarray(0, 20), 0, 1, DEK)).rejects.toThrow(
      MalformedSealedBlobError,
    );
  });

  it('refuses an unknown envelope version rather than guessing', async () => {
    const sealed = await sealChunk(payload(64), 0, 1, DEK);
    sealed[0] = 0x02;

    await expect(openChunk(sealed, 0, 1, DEK)).rejects.toThrow(UnsupportedSealedVersionError);
  });
});

describe('a whole object', () => {
  it('reassembles in order and refuses to reassemble out of it', async () => {
    const chunks = await Promise.all(
      [0, 1, 2].map((index) => sealChunk(payload(32, index + 1), index, 3, DEK)),
    );

    for (const [index, chunk] of chunks.entries()) {
      expect(await openChunk(chunk, index, 3, DEK)).toEqual(payload(32, index + 1));
    }

    await expect(openChunk(chunks[2], 1, 3, DEK)).rejects.toThrow(ChunkPositionError);
  });

  it('is reproducible, which is what lets a chunk be re-sealed instead of held', async () => {
    const first = await sealChunk(payload(64), 0, 2, DEK);
    const second = await sealChunk(payload(64), 0, 2, DEK);

    expect(first).toEqual(second);
  });
});

describe('the derived IV', () => {
  it('is the deterministic construction: eight zero bytes then the index', () => {
    expect(chunkIv(0)).toEqual(new Uint8Array(12));
    expect(chunkIv(1)).toEqual(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    expect(chunkIv(258)).toEqual(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]));
  });

  it('is 12 bytes, so the envelope layout is unchanged', () => {
    expect(chunkIv(7)).toHaveLength(12);
  });

  it('never repeats within a file', () => {
    const seen = new Set([0, 1, 2, 3, 9999].map((index) => chunkIv(index).join(',')));

    expect(seen.size).toBe(5);
  });

  it('travels in the blob, so a reader never has to know how it was chosen', async () => {
    const sealed = await sealChunk(payload(64), 5, 9, DEK);

    expect(sealed.subarray(1, 13)).toEqual(chunkIv(5));
  });

  it('does not repeat (key, IV) across chunks of one object', async () => {
    const first = await sealChunk(payload(64), 0, 2, DEK);
    const second = await sealChunk(payload(64), 1, 2, DEK);

    expect(first.subarray(1, 13)).not.toEqual(second.subarray(1, 13));
  });

  it('leaves a chunk sealed under a random IV readable, because the reader takes it from the blob', async () => {
    const { sealBytes } = await import('@/lib/sealed');
    const header = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1]);
    const legacy = await sealBytes(concatBytes(header, payload(32)), DEK);

    expect(legacy.subarray(1, 13)).not.toEqual(chunkIv(0));
    expect(await openChunk(legacy, 0, 1, DEK)).toEqual(payload(32));
  });
});
