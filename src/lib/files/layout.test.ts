import { describe, expect, it } from 'vitest';
import {
  CHUNK_OVERHEAD_BYTES,
  CHUNK_PAYLOAD_BYTES,
  CHUNK_STRIDE_BYTES,
  PADDING_BUCKET_BYTES,
  chunkCountFor,
  chunkRange,
  layoutFor,
  layoutMatchesRow,
  padToBucket,
  payloadBytesFor,
} from './layout';

describe('the constants the server also holds', () => {
  it('matches service.ChunkSize, ChunkOverhead and ChunkStride', () => {
    expect(CHUNK_PAYLOAD_BYTES).toBe(8388608);
    expect(CHUNK_OVERHEAD_BYTES).toBe(37);
    expect(CHUNK_STRIDE_BYTES).toBe(8388645);
  });

  it('carries the 37 bytes the position header made necessary', () => {
    expect(CHUNK_OVERHEAD_BYTES).toBe(1 + 12 + 8 + 16);
    expect(CHUNK_OVERHEAD_BYTES).not.toBe(29);
  });
});

describe('padding', () => {
  it('rounds up to the next 64 KiB bucket', () => {
    expect(padToBucket(1)).toBe(PADDING_BUCKET_BYTES);
    expect(padToBucket(PADDING_BUCKET_BYTES - 1)).toBe(PADDING_BUCKET_BYTES);
    expect(padToBucket(PADDING_BUCKET_BYTES)).toBe(PADDING_BUCKET_BYTES);
    expect(padToBucket(PADDING_BUCKET_BYTES + 1)).toBe(PADDING_BUCKET_BYTES * 2);
  });

  it('gives an empty file one bucket rather than nothing to upload', () => {
    expect(padToBucket(0)).toBe(PADDING_BUCKET_BYTES);
  });

  it('costs a 40 KB note 64 KiB, not a whole 8 MiB chunk', () => {
    expect(padToBucket(40_000)).toBe(65_536);
    expect(padToBucket(40_000)).toBeLessThan(CHUNK_PAYLOAD_BYTES);
  });

  it('refuses a negative length rather than returning a bucket', () => {
    expect(() => padToBucket(-1)).toThrow(RangeError);
  });
});

describe('object layout', () => {
  it('is one chunk for anything up to a full payload', () => {
    expect(chunkCountFor(1)).toBe(1);
    expect(chunkCountFor(CHUNK_PAYLOAD_BYTES)).toBe(1);
    expect(chunkCountFor(CHUNK_PAYLOAD_BYTES + 1)).toBe(2);
  });

  it('adds the envelope once per chunk, not once per object', () => {
    const small = layoutFor(40_000);

    expect(small.chunkCount).toBe(1);
    expect(small.paddedBytes).toBe(65_536);
    expect(small.storedBytes).toBe(65_536 + 37);
  });

  it('is not chunkCount times the stride when the last chunk is short', () => {
    const layout = layoutFor(40_000);

    expect(layout.storedBytes).not.toBe(layout.chunkCount * CHUNK_STRIDE_BYTES);
    expect(layout.storedBytes).toBe(65_573);
  });

  it('is exactly the stride when the payload fills its chunks', () => {
    const layout = layoutFor(CHUNK_PAYLOAD_BYTES * 2);

    expect(layout.chunkCount).toBe(2);
    expect(layout.storedBytes).toBe(2 * CHUNK_STRIDE_BYTES);
  });

  it('agrees with the server rule that ceil(size / stride) is the chunk count', () => {
    for (const plaintext of [0, 1, 40_000, 65_536, 65_537, CHUNK_PAYLOAD_BYTES,
      CHUNK_PAYLOAD_BYTES + 1, CHUNK_PAYLOAD_BYTES * 3 + 12_345, 4_000_000_000]) {
      const layout = layoutFor(plaintext);

      expect(Math.ceil(layout.storedBytes / CHUNK_STRIDE_BYTES)).toBe(layout.chunkCount);
    }
  });
});

describe('chunk payload sizes', () => {
  it('is a full payload for every chunk but the last', () => {
    const padded = padToBucket(CHUNK_PAYLOAD_BYTES * 2 + 1000);

    expect(payloadBytesFor(padded, 0)).toBe(CHUNK_PAYLOAD_BYTES);
    expect(payloadBytesFor(padded, 1)).toBe(CHUNK_PAYLOAD_BYTES);
    expect(payloadBytesFor(padded, 2)).toBe(padded - CHUNK_PAYLOAD_BYTES * 2);
  });

  it('sums back to the padded length', () => {
    const padded = padToBucket(CHUNK_PAYLOAD_BYTES * 2 + 1000);
    const count = chunkCountFor(padded);
    let total = 0;

    for (let index = 0; index < count; index += 1) {
      total += payloadBytesFor(padded, index);
    }

    expect(total).toBe(padded);
  });

  it('refuses a chunk index the object does not have', () => {
    expect(() => payloadBytesFor(65_536, 1)).toThrow(RangeError);
    expect(() => payloadBytesFor(65_536, -1)).toThrow(RangeError);
  });
});

describe('ranged reads', () => {
  it('starts chunk n at n times the stride', () => {
    const padded = padToBucket(CHUNK_PAYLOAD_BYTES * 3);

    expect(chunkRange(padded, 0).start).toBe(0);
    expect(chunkRange(padded, 1).start).toBe(CHUNK_STRIDE_BYTES);
    expect(chunkRange(padded, 2).start).toBe(2 * CHUNK_STRIDE_BYTES);
  });

  it('would drift 8 bytes per chunk if the overhead were 29', () => {
    const padded = padToBucket(CHUNK_PAYLOAD_BYTES * 4);
    const wrongStride = CHUNK_PAYLOAD_BYTES + 29;

    expect(chunkRange(padded, 3).start - 3 * wrongStride).toBe(24);
  });

  it('covers the object exactly, with no gap and no overlap', () => {
    const padded = padToBucket(CHUNK_PAYLOAD_BYTES * 2 + 500);
    const layout = layoutFor(CHUNK_PAYLOAD_BYTES * 2 + 500);
    const last = chunkRange(padded, layout.chunkCount - 1);

    for (let index = 1; index < layout.chunkCount; index += 1) {
      expect(chunkRange(padded, index).start).toBe(chunkRange(padded, index - 1).endExclusive);
    }
    expect(last.endExclusive).toBe(layout.storedBytes);
  });
});

describe('checking a manifest against its ledger row', () => {
  it('accepts a row that describes the same object', () => {
    const layout = layoutFor(2_483_911);

    expect(layoutMatchesRow(layout, layout.storedBytes, layout.chunkCount)).toBe(true);
  });

  it('refuses a row whose size disagrees', () => {
    const layout = layoutFor(2_483_911);

    expect(layoutMatchesRow(layout, layout.storedBytes + 1, layout.chunkCount)).toBe(false);
  });

  it('refuses a row whose chunk count disagrees', () => {
    const layout = layoutFor(2_483_911);

    expect(layoutMatchesRow(layout, layout.storedBytes, layout.chunkCount + 1)).toBe(false);
  });

  it('refuses the formula the design carried until 2026-09-09', () => {
    const layout = layoutFor(40_000);

    expect(layoutMatchesRow(layout, layout.chunkCount * CHUNK_STRIDE_BYTES, layout.chunkCount)).toBe(
      false,
    );
  });
});
