import {
  hashReceivedCiphertext,
  KekNotSpecifiedError,
  type SecretMetaRecord,
  type SecretRecord,
} from '@/lib/secrets';

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

export const VAULT_SEALED_NOTICE =
  'Vault items cannot be opened or created in this build: the key that wraps each item is not ' +
  'specified yet. The index below is real — it comes from the server — but item contents stay ' +
  'sealed until that derivation lands.';

export function isVaultSealed(error: unknown): boolean {
  return error instanceof KekNotSpecifiedError;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
