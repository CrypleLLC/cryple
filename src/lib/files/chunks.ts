import { openBytes, sealBytes } from '@/lib/sealed';
import { concatBytes } from '@/lib/encoding';
import { CHUNK_OVERHEAD_BYTES, POSITION_HEADER_BYTES } from './layout';

export class ChunkPositionError extends Error {
  readonly expected: { index: number; count: number };
  readonly found: { index: number; count: number };

  constructor(expected: { index: number; count: number }, found: { index: number; count: number }) {
    super(
      `chunk claims position ${found.index} of ${found.count}, but was read as ` +
        `${expected.index} of ${expected.count}`,
    );
    this.name = 'ChunkPositionError';
    this.expected = expected;
    this.found = found;
  }
}

function positionHeader(index: number, count: number): Uint8Array {
  const header = new Uint8Array(POSITION_HEADER_BYTES);
  const view = new DataView(header.buffer);

  view.setUint32(0, index, false);
  view.setUint32(4, count, false);

  return header;
}

export async function sealChunk(
  payload: Uint8Array,
  index: number,
  count: number,
  dek: Uint8Array,
): Promise<Uint8Array> {
  if (index < 0 || count < 1 || index >= count) {
    throw new RangeError(`chunk ${index} is outside a ${count}-chunk object`);
  }

  const plaintext = concatBytes(positionHeader(index, count), payload);

  return sealBytes(plaintext, dek);
}

export async function openChunk(
  chunk: Uint8Array,
  index: number,
  count: number,
  dek: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await openBytes(chunk, dek);

  if (plaintext.length < POSITION_HEADER_BYTES) {
    throw new ChunkPositionError({ index, count }, { index: -1, count: -1 });
  }

  const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
  const found = { index: view.getUint32(0, false), count: view.getUint32(4, false) };

  if (found.index !== index || found.count !== count) {
    throw new ChunkPositionError({ index, count }, found);
  }

  return plaintext.subarray(POSITION_HEADER_BYTES);
}

export function sealedChunkLength(payloadBytes: number): number {
  return payloadBytes + CHUNK_OVERHEAD_BYTES;
}
