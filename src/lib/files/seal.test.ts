import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes } from '@/lib/encoding';
import { sealObject, type SealSource } from './seal';
import { memorySink, SealBufferExceededError } from './sink';
import { openChunk } from './chunks';
import { CHUNK_PAYLOAD_BYTES, layoutFor } from './layout';

const DEK = new Uint8Array(32).fill(5);

interface UploadSeen {
  sealedBytes: number;
  totalBytes: number;
}

function source(bytes: Uint8Array, sliceSize = 4096): SealSource {
  return {
    size: bytes.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += sliceSize) {
            controller.enqueue(bytes.subarray(at, Math.min(at + sliceSize, bytes.length)));
          }
          controller.close();
        },
      }),
  };
}

function bytes(length: number, seed = 1): Uint8Array {
  const tile = Uint8Array.from({ length: Math.min(length, 4096) }, (_, index) => (index * 31 + seed) % 251);
  const out = new Uint8Array(length);
  for (let at = 0; at < length; at += tile.length) {
    out.set(tile.subarray(0, Math.min(tile.length, length - at)), at);
  }
  return out;
}

async function collect(sink: ReturnType<typeof memorySink>, count: number): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push(await sink.read(index));
  }
  return out;
}

describe('sealing an object', () => {
  it('produces the layout the row will declare', async () => {
    const sink = memorySink();
    const sealed = await sealObject(source(bytes(40_000)), DEK, sink);

    expect(sealed.chunkCount).toBe(1);
    expect(sealed.paddedBytes).toBe(65_536);
    expect(sealed.storedBytes).toBe(65_573);
  });

  it('hashes the finished object, so the hash matches the concatenated chunks', async () => {
    const sink = memorySink();
    const sealed = await sealObject(source(bytes(200_000)), DEK, sink);
    const chunks = await collect(sink, sealed.chunkCount);

    expect(sealed.ciphertextSha256).toBe(bytesToHex(sha256(concatBytes(...chunks))));
    expect(sealed.ciphertextSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips the plaintext, with the padding as trailing zeros', async () => {
    const plaintext = bytes(40_000);
    const sink = memorySink();
    const sealed = await sealObject(source(plaintext), DEK, sink);

    const opened = await openChunk(await sink.read(0), 0, sealed.chunkCount, DEK);

    expect(bytesToHex(sha256(opened.subarray(0, plaintext.length)))).toBe(
      bytesToHex(sha256(plaintext)),
    );
    expect(opened.length).toBe(65_536);
    expect(opened.subarray(plaintext.length).every((byte) => byte === 0)).toBe(true);
  });

  it('binds every chunk to its position across a multi-chunk object', { timeout: 60_000 }, async () => {
    const plaintext = bytes(CHUNK_PAYLOAD_BYTES + 100_000);
    const sink = memorySink();
    const sealed = await sealObject(source(plaintext, 1 << 20), DEK, sink);

    expect(sealed.chunkCount).toBe(2);

    const first = await openChunk(await sink.read(0), 0, 2, DEK);
    const second = await openChunk(await sink.read(1), 1, 2, DEK);

    expect(bytesToHex(sha256(concatBytes(first, second).subarray(0, plaintext.length)))).toBe(
      bytesToHex(sha256(plaintext)),
    );
    await expect(openChunk(await sink.read(1), 0, 2, DEK)).rejects.toThrow();
  });

  it('seals an empty file as one padded chunk rather than nothing', async () => {
    const sink = memorySink();
    const sealed = await sealObject(source(new Uint8Array(0)), DEK, sink);

    expect(sealed.chunkCount).toBe(1);
    expect(sealed.storedBytes).toBe(65_573);

    const opened = await openChunk(await sink.read(0), 0, 1, DEK);
    expect(opened.every((byte) => byte === 0)).toBe(true);
  });

  it('does not care how the stream is chunked', async () => {
    const plaintext = bytes(150_000);

    for (const sliceSize of [7, 997, 65_536, 1 << 20]) {
      const sink = memorySink();
      const sealed = await sealObject(source(plaintext, sliceSize), DEK, sink);
      const opened = await openChunk(await sink.read(0), 0, sealed.chunkCount, DEK);

      expect(sealed.storedBytes).toBe(layoutFor(plaintext.length).storedBytes);
      expect(bytesToHex(sha256(opened.subarray(0, plaintext.length)))).toBe(
        bytesToHex(sha256(plaintext)),
      );
    }
  });

  it('seals differently every time, because each chunk draws a fresh IV', async () => {
    const plaintext = bytes(1000);
    const first = memorySink();
    const second = memorySink();

    await sealObject(source(plaintext), DEK, first);
    await sealObject(source(plaintext), DEK, second);

    expect(await first.read(0)).not.toEqual(await second.read(0));
  });

  it('reports progress that ends at the stored size', async () => {
    const seen: UploadSeen[] = [];
    const sink = memorySink();
    const sealed = await sealObject(source(bytes(40_000)), DEK, sink, {
      onProgress: (progress) => seen.push({ ...progress }),
    });

    expect(seen).toHaveLength(sealed.chunkCount);
    expect(seen[seen.length - 1]).toEqual({
      sealedBytes: sealed.storedBytes,
      totalBytes: sealed.storedBytes,
    });
  });
});

describe('a source that lies about its length', () => {
  it('refuses one that produces fewer bytes than it declared', async () => {
    const short: SealSource = {
      size: 100_000,
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes(10));
            controller.close();
          },
        }),
    };

    await expect(sealObject(short, DEK, memorySink())).rejects.toThrow(/produced 10 bytes/);
  });

  it('refuses one that produces more, rather than truncating it silently', async () => {
    const long: SealSource = {
      size: 10,
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes(100_000));
            controller.close();
          },
        }),
    };

    await expect(sealObject(long, DEK, memorySink())).rejects.toThrow(/more than the 10 bytes/);
  });
});

describe('the sealed buffer ceiling', () => {
  it('refuses an object larger than the buffer, instead of running out of memory', async () => {
    const sink = memorySink(64 << 10);

    await expect(sealObject(source(bytes(200_000)), DEK, sink)).rejects.toThrow(
      SealBufferExceededError,
    );
  });

  it('says why the whole object has to be held at all', async () => {
    const sink = memorySink(1024);

    await expect(sealObject(source(bytes(200_000)), DEK, sink)).rejects.toThrow(
      /before the upload can be authorised/,
    );
  });
});
