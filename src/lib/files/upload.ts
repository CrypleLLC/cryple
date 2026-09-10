import { zeroBytes } from '@/lib/encoding';
import { generateDek } from '@/lib/secrets';
import { completeUpload, createFile, getUploadState, wrapper, type FilesContext } from './api';
import { buildManifest, sealManifest } from './manifest';
import { sealObject, type SealSource } from './seal';
import { memorySink, type SealedSink } from './sink';
import type { CompletedPart, FileRecord, UploadPart, UploadTicket } from './records';

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

export interface UploadFile extends SealSource {
  name: string;
  type: string;
}

export type UploadPhase = 'sealing' | 'uploading' | 'completing';

export interface UploadProgress {
  phase: UploadPhase;
  doneBytes: number;
  totalBytes: number;
}

export interface UploadOptions {
  id?: string;
  sink?: SealedSink;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  put?: PartPutter;
}

export type PartPutter = (
  part: UploadPart,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<string>;

export const fetchPutter: PartPutter = async (part, body, signal) => {
  const response = await fetch(part.url, {
    method: 'PUT',
    body: body as unknown as BodyInit,
    headers: { 'Content-Length': String(body.length) },
    signal,
  });

  if (!response.ok) {
    throw new PartUploadError(part.number, response.status);
  }

  return response.headers.get('ETag') ?? '';
};

export async function uploadFile(
  context: FilesContext,
  file: UploadFile,
  options: UploadOptions = {},
): Promise<FileRecord> {
  const sink = options.sink ?? memorySink();
  const dek = generateDek();

  try {
    const sealed = await sealObject(file, dek, sink, {
      onProgress: ({ sealedBytes, totalBytes }) =>
        options.onProgress?.({ phase: 'sealing', doneBytes: sealedBytes, totalBytes }),
    });

    const manifest = buildManifest(file.name, file.type, file.size);
    const ciphertext = await sealManifest(manifest, dek);
    const wrapped_dek = await wrapper(context).wrapDek(dek);

    const { file: created } = await createFile(context, {
      id: options.id,
      ciphertext,
      wrapped_dek,
      size_bytes: sealed.storedBytes,
      ciphertext_sha256: sealed.ciphertextSha256,
      chunk_count: sealed.chunkCount,
    });

    if (created.upload === undefined) {
      throw new MissingUploadTicketError(created.id);
    }

    const parts = await sendParts(created.upload, sink, sealed.storedBytes, options);

    options.onProgress?.({
      phase: 'completing',
      doneBytes: sealed.storedBytes,
      totalBytes: sealed.storedBytes,
    });

    return completeUpload(context, created.id, created.upload.multipart ? parts : []);
  } finally {
    zeroBytes(dek);
    sink.release();
  }
}

export async function resumeUpload(
  context: FilesContext,
  id: string,
  sink: SealedSink,
  options: Omit<UploadOptions, 'sink' | 'id'> = {},
): Promise<FileRecord> {
  const state = await getUploadState(context, id);

  if (state.parts.length === 0) {
    return completeUpload(context, id, []);
  }

  const ticket: UploadTicket = {
    multipart: true,
    chunk_size: 0,
    parts: state.parts,
    expires_at: '',
  };
  const total = state.parts.reduce((sum, part) => sum + part.size, 0);
  const sent = await sendParts(ticket, sink, total, options);

  return completeUpload(context, id, sent);
}

async function sendParts(
  ticket: UploadTicket,
  sink: SealedSink,
  totalBytes: number,
  options: UploadOptions,
): Promise<CompletedPart[]> {
  const put = options.put ?? fetchPutter;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_PART_CONCURRENCY);
  const completed: CompletedPart[] = [];

  let next = 0;
  let doneBytes = 0;

  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= ticket.parts.length) {
        return;
      }

      const part = ticket.parts[index];
      options.signal?.throwIfAborted();

      const body = await sink.read(part.number - 1);
      const etag = await put(part, body, options.signal);

      completed.push({ number: part.number, etag });
      doneBytes += body.length;
      options.onProgress?.({ phase: 'uploading', doneBytes, totalBytes });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ticket.parts.length) }, () => worker()),
  );

  return completed.sort((a, b) => a.number - b.number);
}
