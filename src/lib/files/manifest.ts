import { openText, sealText } from '@/lib/sealed';
import { CHUNK_PAYLOAD_BYTES, layoutFor, layoutMatchesRow } from './layout';

export interface FileManifest {
  name: string;
  mime: string;
  size: number;
  chunk_size: number;
  chunk_count: number;
  thumbnail_id?: string;
  created_at: string;
}

export class MalformedManifestError extends Error {
  constructor(message: string) {
    super(`this file's details could not be read: ${message}`);
    this.name = 'MalformedManifestError';
  }
}

export class ManifestLayoutError extends Error {
  readonly expectedSizeBytes: number;
  readonly rowSizeBytes: number;

  constructor(expectedSizeBytes: number, rowSizeBytes: number) {
    super(
      'This file does not match its stored size, so it has not been opened. ' +
        `Its details describe ${expectedSizeBytes} stored bytes and the vault holds ` +
        `${rowSizeBytes}. This is almost always a fault in the upload that created it.`,
    );
    this.name = 'ManifestLayoutError';
    this.expectedSizeBytes = expectedSizeBytes;
    this.rowSizeBytes = rowSizeBytes;
  }
}

export function buildManifest(
  name: string,
  mime: string,
  size: number,
  createdAt: Date = new Date(),
): FileManifest {
  const layout = layoutFor(size);

  return {
    name,
    mime,
    size,
    chunk_size: CHUNK_PAYLOAD_BYTES,
    chunk_count: layout.chunkCount,
    created_at: createdAt.toISOString(),
  };
}

export async function sealManifest(manifest: FileManifest, dek: Uint8Array): Promise<string> {
  return sealText(JSON.stringify(manifest), dek);
}

export async function openManifest(ciphertext: string, dek: Uint8Array): Promise<FileManifest> {
  const raw = await openText(ciphertext, dek);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  return assertManifest(parsed);
}

function assertManifest(value: unknown): FileManifest {
  if (typeof value !== 'object' || value === null) {
    throw new MalformedManifestError('it is not an object');
  }

  const candidate = value as Record<string, unknown>;
  for (const field of ['name', 'mime', 'created_at'] as const) {
    if (typeof candidate[field] !== 'string') {
      throw new MalformedManifestError(`${field} is missing`);
    }
  }
  for (const field of ['size', 'chunk_size', 'chunk_count'] as const) {
    const number = candidate[field];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0) {
      throw new MalformedManifestError(`${field} is not a whole number`);
    }
  }
  if (candidate.thumbnail_id !== undefined && typeof candidate.thumbnail_id !== 'string') {
    throw new MalformedManifestError('thumbnail_id is not an id');
  }

  return candidate as unknown as FileManifest;
}

export function assertManifestMatchesRow(manifest: FileManifest, rowSizeBytes: number): void {
  if (manifest.chunk_size !== CHUNK_PAYLOAD_BYTES) {
    throw new ManifestLayoutError(-1, rowSizeBytes);
  }

  const layout = layoutFor(manifest.size);

  if (layout.chunkCount !== manifest.chunk_count) {
    throw new ManifestLayoutError(layout.storedBytes, rowSizeBytes);
  }
  if (!layoutMatchesRow(layout, rowSizeBytes, manifest.chunk_count)) {
    throw new ManifestLayoutError(layout.storedBytes, rowSizeBytes);
  }
}
