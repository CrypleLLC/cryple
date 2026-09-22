import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, zeroBytes } from '@/lib/encoding';
import { getFileDownload, wrapper, type FilesContext } from './api';
import { openChunk } from './chunks';
import { assertManifestMatchesRow, openManifest, type FileManifest } from './manifest';
import { CHUNK_OVERHEAD_BYTES, chunkRange, layoutFor, payloadBytesFor } from './layout';
import type { FileDownload } from './records';

export const DEFAULT_DOWNLOAD_BUFFER_BYTES = 128 << 20;

export class TruncatedObjectError extends Error {
  readonly expectedChunks: number;
  readonly foundChunks: number;

  constructor(expectedChunks: number, foundChunks: number) {
    super(
      `this file is incomplete in storage: it should be ${expectedChunks} chunks and only ` +
        `${foundChunks} arrived`,
    );
    this.name = 'TruncatedObjectError';
    this.expectedChunks = expectedChunks;
    this.foundChunks = foundChunks;
  }
}

export class ObjectDigestError extends Error {
  constructor(expected: string, found: string) {
    super(`this file does not match the hash recorded for it (expected ${expected}, got ${found})`);
    this.name = 'ObjectDigestError';
  }
}

export class DownloadBufferExceededError extends Error {
  constructor(bytes: number, limitBytes: number) {
    super(
      `this file is ${bytes} plaintext bytes and the in-memory limit is ${limitBytes}. ` +
        'Stream it instead of asking for the whole thing at once.',
    );
    this.name = 'DownloadBufferExceededError';
  }
}

export interface OpenedFile {
  record: FileDownload;
  manifest: FileManifest;
  dek: Uint8Array;
}

export async function openFile(context: FilesContext, id: string): Promise<OpenedFile> {
  const record = await getFileDownload(context, id);
  const dek = await wrapper(context).unwrapDek(record);

  try {
    const manifest = await openManifest(record.ciphertext, dek);
    assertManifestMatchesRow(manifest, record.size_bytes);

    return { record, manifest, dek };
  } catch (error) {
    zeroBytes(dek);
    throw error;
  }
}

export interface DecryptOptions {
  expectedSha256?: string;
  ownsDek?: boolean;
}

export function decryptStream(
  source: ReadableStream<Uint8Array>,
  manifest: FileManifest,
  dek: Uint8Array,
  options: DecryptOptions = {},
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const digest = sha256.create();

  let index = 0;
  let held = new Uint8Array(sealedLengthOf(manifest, 0));
  let filled = 0;
  let emitted = 0;
  let finished = false;

  const release = () => {
    if (options.ownsDek === true) {
      zeroBytes(dek);
    }
  };

  const emit = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    digest.update(held);

    const payload = await openChunk(held, index, manifest.chunk_count, dek);
    const remaining = manifest.size - emitted;
    const usable = payload.subarray(0, Math.max(0, Math.min(payload.length, remaining)));

    if (usable.length > 0) {
      controller.enqueue(usable);
      emitted += usable.length;
    }

    index += 1;
    filled = 0;
    if (index < manifest.chunk_count) {
      held = new Uint8Array(sealedLengthOf(manifest, index));
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) {
        return;
      }

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          finished = true;

          if (filled > 0 || index < manifest.chunk_count) {
            release();
            controller.error(new TruncatedObjectError(manifest.chunk_count, index));
            return;
          }

          const found = bytesToHex(digest.digest());
          if (options.expectedSha256 !== undefined && options.expectedSha256 !== found) {
            release();
            controller.error(new ObjectDigestError(options.expectedSha256, found));
            return;
          }

          release();
          controller.close();
          return;
        }

        let offset = 0;
        while (offset < value.length) {
          if (index >= manifest.chunk_count) {
            finished = true;
            release();
            controller.error(
              new Error('the object is longer than its chunk count describes'),
            );
            return;
          }

          const take = Math.min(held.length - filled, value.length - offset);
          held.set(value.subarray(offset, offset + take), filled);
          filled += take;
          offset += take;

          if (filled === held.length) {
            await emit(controller);
          }
        }

        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          return;
        }
      }
    },

    cancel(reason) {
      finished = true;
      release();
      return reader.cancel(reason);
    },
  });
}

export interface DownloadOptions {
  maxBytes?: number;
  verifyDigest?: boolean;
  fetchImpl?: typeof fetch;
}

export interface DownloadedFile {
  manifest: FileManifest;
  bytes: Uint8Array;
}

export async function downloadFile(
  context: FilesContext,
  id: string,
  options: DownloadOptions = {},
): Promise<DownloadedFile> {
  const limit = options.maxBytes ?? DEFAULT_DOWNLOAD_BUFFER_BYTES;
  const { record, manifest, dek } = await openFile(context, id);

  try {
    if (manifest.size > limit) {
      throw new DownloadBufferExceededError(manifest.size, limit);
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(record.url);
    if (!response.ok || response.body === null) {
      throw new Error(`the object store answered ${response.status} for this file`);
    }

    const plaintext = decryptStream(response.body, manifest, dek, {
      expectedSha256: options.verifyDigest === false ? undefined : record.ciphertext_sha256,
    });

    return { manifest, bytes: await collect(plaintext, manifest.size) };
  } finally {
    zeroBytes(dek);
  }
}

export async function fetchSealedObject(
  context: FilesContext,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const record = await getFileDownload(context, id);
  const response = await fetchImpl(record.url);
  if (!response.ok) {
    throw new Error(`the object store answered ${response.status} for this file`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function openSealedObject(
  sealed: Uint8Array,
  manifest: FileManifest,
  dek: Uint8Array,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sealed);
      controller.close();
    },
  });

  return collect(decryptStream(source, manifest, dek), manifest.size);
}

export async function readChunk(
  url: string,
  manifest: FileManifest,
  index: number,
  dek: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const range = chunkRange(layoutFor(manifest.size).paddedBytes, index);

  const response = await fetchImpl(url, {
    headers: { Range: `bytes=${range.start}-${range.endExclusive - 1}` },
  });
  if (!response.ok) {
    throw new Error(`the object store answered ${response.status} for chunk ${index}`);
  }

  const chunk = new Uint8Array(await response.arrayBuffer());
  return openChunk(chunk, index, manifest.chunk_count, dek);
}

function sealedLengthOf(manifest: FileManifest, index: number): number {
  return payloadBytesFor(layoutFor(manifest.size).paddedBytes, index) + CHUNK_OVERHEAD_BYTES;
}

async function collect(stream: ReadableStream<Uint8Array>, size: number): Promise<Uint8Array> {
  const out = new Uint8Array(size);
  const reader = stream.getReader();
  let at = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out.set(value, at);
    at += value.length;
  }

  return at === size ? out : out.subarray(0, at);
}
