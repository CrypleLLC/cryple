export const CHUNK_PAYLOAD_BYTES = 8 << 20;
export const CHUNK_OVERHEAD_BYTES = 37;
export const CHUNK_STRIDE_BYTES = CHUNK_PAYLOAD_BYTES + CHUNK_OVERHEAD_BYTES;
export const PADDING_BUCKET_BYTES = 64 << 10;
export const POSITION_HEADER_BYTES = 8;

export interface ObjectLayout {
  paddedBytes: number;
  chunkCount: number;
  storedBytes: number;
}

export function padToBucket(plaintextBytes: number): number {
  if (plaintextBytes < 0) {
    throw new RangeError(`plaintext length ${plaintextBytes} is negative`);
  }
  if (plaintextBytes === 0) {
    return PADDING_BUCKET_BYTES;
  }

  return Math.ceil(plaintextBytes / PADDING_BUCKET_BYTES) * PADDING_BUCKET_BYTES;
}

export function chunkCountFor(paddedBytes: number): number {
  return Math.max(1, Math.ceil(paddedBytes / CHUNK_PAYLOAD_BYTES));
}

export function layoutFor(plaintextBytes: number): ObjectLayout {
  const paddedBytes = padToBucket(plaintextBytes);
  const chunkCount = chunkCountFor(paddedBytes);

  return {
    paddedBytes,
    chunkCount,
    storedBytes: paddedBytes + chunkCount * CHUNK_OVERHEAD_BYTES,
  };
}

export function payloadBytesFor(paddedBytes: number, index: number): number {
  const chunkCount = chunkCountFor(paddedBytes);

  if (index < 0 || index >= chunkCount) {
    throw new RangeError(`chunk ${index} is outside a ${chunkCount}-chunk object`);
  }

  return index < chunkCount - 1
    ? CHUNK_PAYLOAD_BYTES
    : paddedBytes - index * CHUNK_PAYLOAD_BYTES;
}

export interface ByteRange {
  start: number;
  endExclusive: number;
}

export function chunkRange(paddedBytes: number, index: number): ByteRange {
  const start = index * CHUNK_STRIDE_BYTES;

  return {
    start,
    endExclusive: start + payloadBytesFor(paddedBytes, index) + CHUNK_OVERHEAD_BYTES,
  };
}

export function layoutMatchesRow(
  layout: ObjectLayout,
  rowSizeBytes: number,
  rowChunkCount: number,
): boolean {
  return layout.storedBytes === rowSizeBytes && layout.chunkCount === rowChunkCount;
}
