import { hashReceivedCiphertext, type SecretMetaRecord, type SecretRecord } from '@/lib/secrets';

export interface VaultEntry {
  id: string;
  bytes: number;
  version: string;
  updatedAt: string;
  reportedHash: string;
}

export function buildVaultIndex(meta: readonly SecretMetaRecord[]): VaultEntry[] {
  return meta
    .map((record) => ({
      id: record.id,
      bytes: record.ciphertext_bytes,
      version: record.version,
      updatedAt: record.updated_at,
      reportedHash: record.ciphertext_sha256,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type IntegrityResult =
  | { matches: true; hash: string }
  | { matches: false; hash: string; reported: string };

export async function checkIntegrity(
  secret: SecretRecord,
  entry: VaultEntry,
): Promise<IntegrityResult> {
  const hash = await hashReceivedCiphertext(secret.ciphertext);

  return hash === entry.reportedHash
    ? { matches: true, hash }
    : { matches: false, hash, reported: entry.reportedHash };
}

export interface SecretPayload {
  name: string;
  value: string;
}

export class MalformedSecretPayloadError extends Error {
  constructor() {
    super('This item was not written by this vault UI and cannot be displayed.');
    this.name = 'MalformedSecretPayloadError';
  }
}

export function encodeSecretPayload(payload: SecretPayload): string {
  return JSON.stringify(payload);
}

export function decodeSecretPayload(plaintext: string): SecretPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new MalformedSecretPayloadError();
  }

  const name = (parsed as Partial<SecretPayload> | null)?.name;
  const value = (parsed as Partial<SecretPayload> | null)?.value;
  if (typeof name !== 'string' || typeof value !== 'string') {
    throw new MalformedSecretPayloadError();
  }

  return { name, value };
}

export const UNREADABLE_SECRET_NAME = 'Unreadable item';

export const MASKED_VALUE = '••••••••';

export interface VaultRow {
  id: string;
  name: string;
  value: string;
  bytes: number;
  version: string;
  updatedAt: string;
  readable: boolean;
}

export interface OpenedSecret {
  record: SecretRecord;
  plaintext?: string;
}

export function buildVaultRows(opened: readonly OpenedSecret[]): VaultRow[] {
  return opened
    .map((entry) => toVaultRow(entry))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function toVaultRow({ record, plaintext }: OpenedSecret): VaultRow {
  const row = {
    id: record.id,
    bytes: receivedBytes(record.ciphertext),
    version: record.version,
    updatedAt: record.updated_at,
  };

  if (plaintext === undefined) {
    return { ...row, name: UNREADABLE_SECRET_NAME, value: '', readable: false };
  }

  try {
    const payload = decodeSecretPayload(plaintext);
    return { ...row, name: payload.name, value: payload.value, readable: true };
  } catch {
    return { ...row, name: UNREADABLE_SECRET_NAME, value: '', readable: false };
  }
}

function receivedBytes(ciphertext: string): number {
  return new TextEncoder().encode(ciphertext).length;
}

const BYTE_UNITS = ['KiB', 'MiB', 'GiB', 'TiB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}
