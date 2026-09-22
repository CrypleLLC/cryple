import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, zeroBytes } from '@/lib/encoding';
import { generateDek } from '@/lib/secrets';
import { completeUpload, createFile, getUploadState, wrapper, type FilesContext } from './api';
import { withCurrentGeneration } from '@/lib/keyrings';
import { assertManifestMatchesRow, buildManifest, openManifest, sealManifest } from './manifest';
import { sealChunk } from './chunks';
import { layoutFor, payloadBytesFor } from './layout';
import { THUMBNAIL_MIME, THUMBNAIL_NAME } from './thumbnails';
import type { FileRecord, UploadPart } from './records';

export const DEFAULT_PART_CONCURRENCY = 3;

export class MissingUploadTicketError extends Error {
  constructor(id: string) {
    super(`the server returned no upload ticket for ${id}, so there is nowhere to send the bytes`);
    this.name = 'MissingUploadTicketError';
  }
}

export class PartUploadError extends Error {
  readonly partNumber: number;
  readonly status: number;

  constructor(partNumber: number, status: number) {
    super(`part ${partNumber} was rejected by the object store with status ${status}`);
    this.name = 'PartUploadError';
    this.partNumber = partNumber;
    this.status = status;
  }
}

export class SourceMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceMismatchError';
  }
}

export class SourceLengthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceLengthError';
  }
}

export interface UploadFile {
  name: string;
  type: string;
  size: number;
  stream: () => ReadableStream<Uint8Array>;
}

export type UploadPhase = 'uploading' | 'completing';

export interface UploadProgress {
  phase: UploadPhase;
  doneBytes: number;
  totalBytes: number;
}

export type PartPutter = (
  part: UploadPart,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<void>;

export interface UploadOptions {
  id?: string;
  thumbnailId?: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  put?: PartPutter;
}

export const fetchPutter: PartPutter = async (part, body, signal) => {
  const response = await fetch(part.url, {
    method: 'PUT',
    body: body as unknown as BodyInit,
    signal,
  });

  if (!response.ok) {
    throw new PartUploadError(part.number, response.status);
  }
};

export async function uploadFile(
  context: FilesContext,
  file: UploadFile,
  options: UploadOptions = {},
): Promise<FileRecord> {
  const layout = layoutFor(file.size);
  const dek = generateDek();

  try {
    const manifest = buildManifest({
      name: file.name,
      mime: file.type,
      size: file.size,
      firstChunkSha256: await firstChunkDigest(file, dek, layout),
      thumbnailId: options.thumbnailId,
    });
    const ciphertext = await sealManifest(manifest, dek);
    const id = options.id ?? crypto.randomUUID();

    const { file: created } = await withCurrentGeneration(context, async () =>
      createFile(context, {
        id,
        ciphertext,
        ...(await wrapper(context).wrapDek(dek)),
        size_bytes: layout.storedBytes,
        chunk_count: layout.chunkCount,
      }),
    );

    if (created.upload === undefined) {
      throw new MissingUploadTicketError(created.id);
    }

    const sent = await streamChunks(file, dek, created.upload.parts, layout, options);

    options.onProgress?.({
      phase: 'completing',
      doneBytes: layout.storedBytes,
      totalBytes: layout.storedBytes,
    });

    return completeUpload(context, created.id, sent.ciphertextSha256);
  } finally {
    zeroBytes(dek);
  }
}

export async function uploadThumbnail(
  context: FilesContext,
  preview: Blob,
  id: string,
): Promise<string | undefined> {
  try {
    const stored = await uploadFile(context, {
      name: THUMBNAIL_NAME,
      type: THUMBNAIL_MIME,
      size: preview.size,
      stream: () => preview.stream(),
    }, { id });

    return stored.id;
  } catch {
    return undefined;
  }
}

export interface ResumableFile {
  id: string;
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  size_bytes: number;
}

export async function resumeUpload(
  context: FilesContext,
  row: ResumableFile,
  file: UploadFile,
  options: UploadOptions = {},
): Promise<FileRecord> {
  const dek = await wrapper(context).unwrapDek(row);

  try {
    const manifest = await openManifest(row.ciphertext, dek);
    assertManifestMatchesRow(manifest, row.size_bytes);

    const layout = layoutFor(manifest.size);
    await assertSameSource(file, manifest, dek, layout);

    const state = await getUploadState(context, row.id);
    const sent = await streamChunks(file, dek, state.parts, layout, options, new Set(state.uploaded));

    options.onProgress?.({
      phase: 'completing',
      doneBytes: layout.storedBytes,
      totalBytes: layout.storedBytes,
    });

    return completeUpload(context, row.id, sent.ciphertextSha256);
  } finally {
    zeroBytes(dek);
  }
}

// The parts already in R2 were sealed from bytes this tab has forgotten, and
// nothing downstream would notice a different file: PATCH only checks the
// object's length, and the hash sent with it covers every chunk including the
// ones being skipped. So a wrong source produces a stored object whose digest
// matches nothing, discovered by the mirror worker days later. Sealing is
// deterministic under a derived IV and a per-file DEK, so re-sealing the first
// chunk and comparing digests turns that into a refusal here.
async function assertSameSource(
  file: UploadFile,
  manifest: Awaited<ReturnType<typeof openManifest>>,
  dek: Uint8Array,
  layout: ReturnType<typeof layoutFor>,
): Promise<void> {
  if (file.size !== manifest.size) {
    throw new SourceMismatchError(
      `this file is ${file.size} bytes and the unfinished upload was ${manifest.size}. ` +
        'Pick the same file, or start the upload again.',
    );
  }
  if (file.name !== manifest.name) {
    throw new SourceMismatchError(
      `the unfinished upload is "${manifest.name}" and this file is "${file.name}". ` +
        'Pick the same file, or start the upload again.',
    );
  }
  if (manifest.first_chunk_sha256 === undefined) {
    throw new SourceMismatchError(
      'this upload was started before resuming was possible, so it cannot be continued. ' +
        'Start the upload again.',
    );
  }

  const digest = await firstChunkDigest(file, dek, layout);
  if (digest !== manifest.first_chunk_sha256) {
    throw new SourceMismatchError(
      'this file has the same name and size as the unfinished upload but different contents, ' +
        'so continuing would store something that opens as neither. Start the upload again.',
    );
  }
}

// Sealed rather than plain, because it is compared against a value written by
// the upload that is being resumed, and because it costs one chunk of memory
// either way.
async function firstChunkDigest(
  file: UploadFile,
  dek: Uint8Array,
  layout: ReturnType<typeof layoutFor>,
): Promise<string> {
  const payload = new Uint8Array(payloadBytesFor(layout.paddedBytes, 0));
  const wanted = Math.min(payload.length, file.size);
  const reader = file.stream().getReader();
  let filled = 0;

  try {
    while (filled < wanted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const take = Math.min(value.length, wanted - filled);
      payload.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    reader.releaseLock();
    void file.stream().cancel();
  }

  if (filled !== wanted) {
    throw new SourceLengthError(
      `the source produced ${filled} bytes and declared at least ${wanted}`,
    );
  }

  const chunk = await sealChunk(payload, 0, layout.chunkCount, dek);
  zeroBytes(payload);

  return bytesToHex(sha256(chunk));
}

interface StreamResult {
  ciphertextSha256: string;
}

// `skip` is what makes resuming worth doing, and it only covers the PUT: every
// chunk is still read, padded, sealed and folded into the digest, because the
// hash sent at PATCH covers the finished object rather than the bytes this pass
// happened to send.
async function streamChunks(
  file: UploadFile,
  dek: Uint8Array,
  parts: readonly UploadPart[],
  layout: ReturnType<typeof layoutFor>,
  options: UploadOptions,
  skip: ReadonlySet<number> = new Set(),
): Promise<StreamResult> {
  const put = options.put ?? fetchPutter;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_PART_CONCURRENCY);
  const byNumber = new Map(parts.map((part) => [part.number, part]));

  const digest = sha256.create();
  const inFlight = new Set<Promise<void>>();

  // A part that fails while another is still in flight leaves that other one
  // abandoned. If it rejects too, nobody is awaiting it and it surfaces as an
  // unhandled rejection rather than as this upload's error. So a task never
  // rejects: it records the first failure and the loop raises it.
  let failure: unknown;

  const reader = file.stream().getReader();
  let index = 0;
  let payload = new Uint8Array(payloadBytesFor(layout.paddedBytes, 0));
  let filled = 0;
  let plaintextRead = 0;
  let doneBytes = 0;

  const send = async (chunk: Uint8Array, number: number) => {
    const part = byNumber.get(number);
    if (part === undefined) {
      throw new MissingUploadTicketError(`part ${number}`);
    }

    await put(part, chunk, options.signal);
    doneBytes += chunk.length;
    options.onProgress?.({ phase: 'uploading', doneBytes, totalBytes: layout.storedBytes });
  };

  const flush = async () => {
    const chunk = await sealChunk(payload, index, layout.chunkCount, dek);
    digest.update(chunk);

    const number = index + 1;
    if (skip.has(number)) {
      doneBytes += chunk.length;
      options.onProgress?.({ phase: 'uploading', doneBytes, totalBytes: layout.storedBytes });
      advance();

      return;
    }

    const task = send(chunk, number)
      .catch((error: unknown) => {
        failure ??= error;
      })
      .finally(() => inFlight.delete(task));
    inFlight.add(task);

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
    raiseFailure();

    advance();
  };

  const advance = () => {
    zeroBytes(payload);
    index += 1;
    filled = 0;
    if (index < layout.chunkCount) {
      payload = new Uint8Array(payloadBytesFor(layout.paddedBytes, index));
    }
  };

  const raiseFailure = () => {
    if (failure !== undefined) {
      throw failure;
    }
  };

  try {
    for (;;) {
      options.signal?.throwIfAborted();

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      let offset = 0;
      while (offset < value.length) {
        if (plaintextRead >= file.size) {
          throw new SourceLengthError(
            `the source produced more than the ${file.size} bytes it declared`,
          );
        }

        const take = Math.min(payload.length - filled, value.length - offset, file.size - plaintextRead);
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

  if (plaintextRead !== file.size) {
    await Promise.allSettled(inFlight);
    throw new SourceLengthError(
      `the source produced ${plaintextRead} bytes and declared ${file.size}`,
    );
  }

  while (index < layout.chunkCount) {
    await flush();
  }

  await Promise.all(inFlight);
  raiseFailure();

  return { ciphertextSha256: bytesToHex(digest.digest()) };
}
