import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, zeroBytes } from '@/lib/encoding';
import { sealChunk } from './chunks';
import { CHUNK_PAYLOAD_BYTES, layoutFor, payloadBytesFor } from './layout';
import type { SealedSink } from './sink';

export interface SealSource {
  size: number;
  stream: () => ReadableStream<Uint8Array>;
}

export interface SealedObject {
  storedBytes: number;
  chunkCount: number;
  paddedBytes: number;
  ciphertextSha256: string;
}

export interface SealProgress {
  sealedBytes: number;
  totalBytes: number;
}

export async function sealObject(
  source: SealSource,
  dek: Uint8Array,
  sink: SealedSink,
  options: { onProgress?: (progress: SealProgress) => void } = {},
): Promise<SealedObject> {
  const layout = layoutFor(source.size);
  await sink.reserve(layout.storedBytes, layout.chunkCount);

  const digest = sha256.create();
  const reader = source.stream().getReader();

  let index = 0;
  let payload = new Uint8Array(payloadBytesFor(layout.paddedBytes, 0));
  let filled = 0;
  let plaintextRead = 0;
  let sealedBytes = 0;

  const flush = async () => {
    const chunk = await sealChunk(payload, index, layout.chunkCount, dek);
    digest.update(chunk);
    await sink.write(index, chunk);

    sealedBytes += chunk.length;
    options.onProgress?.({ sealedBytes, totalBytes: layout.storedBytes });

    zeroBytes(payload);
    index += 1;
    filled = 0;

    if (index < layout.chunkCount) {
      payload = new Uint8Array(payloadBytesFor(layout.paddedBytes, index));
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      let offset = 0;
      while (offset < value.length) {
        if (plaintextRead >= source.size) {
          throw new Error(
            `the source produced more than the ${source.size} bytes it declared`,
          );
        }

        const room = payload.length - filled;
        const take = Math.min(room, value.length - offset, source.size - plaintextRead);

        payload.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        plaintextRead += take;

        if (filled === payload.length) {
          await flush();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (plaintextRead !== source.size) {
    throw new Error(
      `the source produced ${plaintextRead} bytes and declared ${source.size}`,
    );
  }

  while (index < layout.chunkCount) {
    await flush();
  }

  return {
    storedBytes: layout.storedBytes,
    chunkCount: layout.chunkCount,
    paddedBytes: layout.paddedBytes,
    ciphertextSha256: bytesToHex(digest.digest()),
  };
}

export function chunkPayloadSize(): number {
  return CHUNK_PAYLOAD_BYTES;
}
