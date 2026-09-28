import { zeroBytes } from '@/lib/encoding';
import { listFiles, wrapper, type FilesContext } from './api';
import { openManifest } from './manifest';
import type { FileRecord } from './records';
import { thumbnailIdsOf } from './thumbnails';

export function storedFileCount(
  records: readonly Pick<FileRecord, 'id' | 'r2_state'>[],
  thumbnailIds: ReadonlySet<string>,
): number {
  return records.filter((record) => record.r2_state === 'ok' && !thumbnailIds.has(record.id)).length;
}

async function thumbnailIdOf(context: FilesContext, record: FileRecord): Promise<{ thumbnail_id?: string }> {
  try {
    const dek = await wrapper(context).unwrapDek(record);
    try {
      const { thumbnail_id } = await openManifest(record.ciphertext, dek);
      return { thumbnail_id };
    } finally {
      zeroBytes(dek);
    }
  } catch {
    return {};
  }
}

export async function countStoredFiles(context: FilesContext): Promise<number> {
  const records = await listFiles(context);
  const manifests = await Promise.all(records.map((record) => thumbnailIdOf(context, record)));
  return storedFileCount(records, thumbnailIdsOf(manifests));
}
