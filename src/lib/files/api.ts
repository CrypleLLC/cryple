import { ApiError, assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { normalizeActionArgs, signActionEnvelope } from '@/lib/signing';
import type { DekWrapper } from '@/lib/secrets';
import { scopeDekWrapper } from '@/lib/keyrings';
import {
  FILE_VERSION,
  type CompletedPart,
  type CreateFileResponse,
  type FileDownload,
  type FileRecord,
  type ResumeResponse,
  type StorageUsage,
} from './records';
import { layoutFor } from './layout';

export interface FilesContext extends AuthedContext {
  dek?: DekWrapper;
}

export function wrapper(context: FilesContext): DekWrapper {
  return context.dek ?? scopeDekWrapper(context, 'files');
}

export interface CreateFileRequest {
  id?: string;
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  size_bytes: number;
  chunk_count: number;
}

export interface CreateFileResult {
  file: CreateFileResponse;
  created: boolean;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export async function createFile(
  context: FilesContext,
  body: CreateFileRequest,
): Promise<CreateFileResult> {
  const id = body.id === undefined ? crypto.randomUUID() : assertCanonicalUuid(body.id);

  if (!Number.isInteger(body.size_bytes) || body.size_bytes < 1) {
    throw new Error(`size_bytes must be a positive integer, got ${body.size_bytes}`);
  }
  if (!Number.isInteger(body.chunk_count) || body.chunk_count < 1) {
    throw new Error(`chunk_count must be a positive integer, got ${body.chunk_count}`);
  }

  const response = await request<CreateFileResponse>({
    method: 'POST',
    path: '/files',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      id,
      ciphertext: body.ciphertext,
      wrapped_dek: body.wrapped_dek,
      key_generation: body.key_generation,
      size_bytes: body.size_bytes,
      chunk_count: body.chunk_count,
      version: FILE_VERSION,
    },
  });

  return { file: response.data, created: response.status === 201 };
}

export async function listFiles(
  context: FilesContext,
  options: { limit?: number; folder?: string } = {},
): Promise<FileRecord[]> {
  return collectPages<FileRecord>(
    (page: PageRequest) =>
      request<FileRecord[]>({
        method: 'GET',
        path: '/files',
        query: { limit: page.limit, cursor: page.cursor, folder: options.folder },
        token: requireToken(context),
        timeoutMs: context.timeoutMs,
      }),
    { limit: options.limit },
  );
}

export async function getStorageUsage(context: FilesContext): Promise<StorageUsage> {
  const response = await request<StorageUsage>({
    method: 'GET',
    path: '/files/usage',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function getFileDownload(
  context: FilesContext,
  id: string,
): Promise<FileDownload> {
  const response = await request<FileDownload>({
    method: 'GET',
    path: `/files/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function getUploadState(
  context: FilesContext,
  id: string,
): Promise<ResumeResponse> {
  const response = await request<ResumeResponse>({
    method: 'GET',
    path: `/files/${assertCanonicalUuid(id)}/upload`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function completeUpload(
  context: FilesContext,
  id: string,
  ciphertextSha256: string,
  parts: readonly CompletedPart[] = [],
): Promise<FileRecord> {
  if (!SHA256_HEX.test(ciphertextSha256)) {
    throw new Error('ciphertext_sha256 must be 64 lowercase hex characters');
  }

  const response = await request<FileRecord>({
    method: 'PATCH',
    path: `/files/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      ciphertext_sha256: ciphertextSha256,
      ...(parts.length === 0 ? {} : { parts: [...parts].sort((a, b) => a.number - b.number) }),
    },
  });
  return response.data;
}

export async function deleteFile(context: FilesContext, id: string): Promise<void> {
  const canonical = assertCanonicalUuid(id);

  const envelope = await signActionEnvelope('file-delete', [canonical], context.session.signer());

  await request<void>({
    method: 'DELETE',
    path: `/files/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export async function abandonUpload(context: FilesContext, id: string): Promise<void> {
  try {
    await request<void>({
      method: 'DELETE',
      path: `/files/${assertCanonicalUuid(id)}/upload`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return;
    }
    throw error;
  }
}

export interface BatchDeleteFilesResult {
  requested: number;
  deleted: number;
}

export async function deleteFiles(
  context: FilesContext,
  ids: readonly string[],
): Promise<BatchDeleteFilesResult> {
  const canonical = ids.map((id) => assertCanonicalUuid(id));
  const normalized = normalizeActionArgs('file-delete', canonical);

  const envelope = await signActionEnvelope('file-delete', normalized, context.session.signer());

  const response = await request<BatchDeleteFilesResult>({
    method: 'DELETE',
    path: '/files',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ids: normalized, ...envelope },
  });

  return response.data;
}

export function declaredLayoutFor(plaintextBytes: number): {
  size_bytes: number;
  chunk_count: number;
} {
  const layout = layoutFor(plaintextBytes);
  return { size_bytes: layout.storedBytes, chunk_count: layout.chunkCount };
}
