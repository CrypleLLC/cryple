import { apiTransport } from './index';
import type { DocumentsContext } from './api';
import { readBodyText, readTitle } from './content';
import type { DocumentMetaRecord } from './records';
import { DocumentSync } from './sync';

export const SUMMARY_FETCH_CONCURRENCY = 4;

export interface DocumentSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  createdAt: string;
  latestSeq: number;
  snapshotSeq: number;
  revision: number;
  readable: boolean;
  failure?: string;
}

export async function loadDocumentSummary(
  context: DocumentsContext,
  meta: DocumentMetaRecord,
): Promise<DocumentSummary> {
  const sync = new DocumentSync(meta.id, apiTransport(context), { pollIntervalMs: 0 });

  const base = {
    id: meta.id,
    updatedAt: meta.updated_at,
    createdAt: meta.created_at,
    latestSeq: meta.latest_seq,
    snapshotSeq: meta.snapshot_seq,
    revision: meta.revision,
  };

  try {
    await sync.open();
    return {
      ...base,
      title: readTitle(sync.doc),
      preview: readBodyText(sync.doc),
      readable: true,
    };
  } catch (error) {
    return {
      ...base,
      title: '',
      preview: '',
      readable: false,
      failure: error instanceof Error ? error.message : String(error),
    };
  } finally {
    sync.destroy();
  }
}

export async function loadDocumentSummaries(
  context: DocumentsContext,
  metas: readonly DocumentMetaRecord[],
): Promise<DocumentSummary[]> {
  const results = new Array<DocumentSummary>(metas.length);
  let next = 0;

  const workers = Array.from(
    { length: Math.min(SUMMARY_FETCH_CONCURRENCY, metas.length) },
    async () => {
      while (next < metas.length) {
        const index = next++;
        results[index] = await loadDocumentSummary(context, metas[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export async function compactForAnchor(context: DocumentsContext, id: string): Promise<void> {
  const sync = new DocumentSync(id, apiTransport(context), { pollIntervalMs: 0, debounceMs: 0 });

  try {
    await sync.open();
    await sync.compact();
  } finally {
    await sync.close();
  }
}
