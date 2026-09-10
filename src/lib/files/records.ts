export const FILE_VERSION = 'v1';

export const R2_STATES = ['pending', 'ok', 'missing'] as const;
export const GCS_STATES = ['pending', 'ok', 'failed'] as const;

export type R2State = (typeof R2_STATES)[number];
export type GcsState = (typeof GCS_STATES)[number];

export interface FileRecord {
  id: string;
  ciphertext: string;
  wrapped_dek: string;
  size_bytes: number;
  ciphertext_sha256: string;
  version: string;
  r2_state: R2State;
  gcs_state: GcsState;
  created_at: string;
  updated_at: string;
}

export interface UploadPart {
  number: number;
  url: string;
  size: number;
}

export interface UploadTicket {
  multipart: boolean;
  chunk_size: number;
  parts: UploadPart[];
  expires_at: string;
}

export interface CreateFileResponse extends FileRecord {
  upload?: UploadTicket;
}

export interface ResumeResponse {
  uploaded: number[];
  parts: UploadPart[];
}

export interface FileDownload extends FileRecord {
  url: string;
  expires_at: string;
}

export interface StorageUsage {
  used_bytes: number;
  quota_bytes: number;
  file_count: number;
}

export interface CompletedPart {
  number: number;
  etag: string;
}

export function isInVault(file: FileRecord): boolean {
  return file.r2_state === 'ok';
}

export function isReplicated(file: FileRecord): boolean {
  return file.gcs_state === 'ok';
}

export function remainingBytes(usage: StorageUsage): number {
  return Math.max(0, usage.quota_bytes - usage.used_bytes);
}

export function fits(usage: StorageUsage, storedBytes: number): boolean {
  return usage.used_bytes + storedBytes <= usage.quota_bytes;
}
