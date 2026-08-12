export const DOCUMENT_VERSION = 'v1';
export const MAX_UPDATES_PER_REQUEST = 256;
export const MAX_UPDATE_CHARACTERS = 262144;
export const DOCUMENT_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const SNAPSHOT_CIPHERTEXT_BUDGET = 6 * 1024 * 1024;

export interface DocumentMetaRecord {
  id: string;
  snapshot_seq: number;
  latest_seq: number;
  revision: number;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  id: string;
  wrapped_dek: string;
  snapshot_ciphertext: string;
  snapshot_seq: number;
  revision: number;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentUpdateRecord {
  seq: number;
  ciphertext: string;
  created_at: string;
}

export interface PendingUpdate {
  client_update_id: string;
  ciphertext: string;
}

export interface AppendResult {
  applied: number;
  skipped: number;
  latest_seq: number;
}

export class SequenceGapError extends Error {
  readonly expected: number;
  readonly found: number;

  constructor(expected: number, found: number) {
    super(
      `document log has a gap: expected seq ${expected}, found ${found} — ` +
        'refusing to compact over missing updates',
    );
    this.name = 'SequenceGapError';
    this.expected = expected;
    this.found = found;
  }
}

export function assertContiguous(
  updates: readonly DocumentUpdateRecord[],
  options: { after?: number } = {},
): void {
  if (updates.length === 0) {
    return;
  }

  if (options.after !== undefined && updates[0].seq !== options.after + 1) {
    throw new SequenceGapError(options.after + 1, updates[0].seq);
  }

  for (let index = 1; index < updates.length; index++) {
    const expected = updates[index - 1].seq + 1;
    if (updates[index].seq !== expected) {
      throw new SequenceGapError(expected, updates[index].seq);
    }
  }
}

export function assertLogFollows(
  updates: readonly DocumentUpdateRecord[],
  snapshotSeq: number,
): void {
  if (updates.length === 0) {
    return;
  }

  const first = updates[0].seq;
  if (first !== 1 && first !== snapshotSeq + 1) {
    throw new SequenceGapError(snapshotSeq + 1, first);
  }
}

export function isContiguous(
  updates: readonly DocumentUpdateRecord[],
  options: { after?: number } = {},
): boolean {
  try {
    assertContiguous(updates, options);
    return true;
  } catch (error) {
    if (error instanceof SequenceGapError) {
      return false;
    }
    throw error;
  }
}

export function highestSeq(fallback: number, updates: readonly DocumentUpdateRecord[]): number {
  return updates.reduce((highest, update) => Math.max(highest, update.seq), fallback);
}
