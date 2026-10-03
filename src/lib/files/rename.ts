import { assertCanonicalUuid, request } from '@/lib/api';
import { requireToken } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { getFileDownload, wrapper, type FilesContext } from './api';
import { openManifest, sealManifest, type FileManifest } from './manifest';
import type { FileRecord } from './records';

export interface RenamedFile {
  record: FileRecord;
  manifest: FileManifest;
}

export async function renameFile(context: FilesContext, id: string, name: string): Promise<RenamedFile> {
  const canonical = assertCanonicalUuid(id);
  const row = await getFileDownload(context, canonical);
  const dek = await wrapper(context).unwrapDek(row);

  try {
    const manifest: FileManifest = { ...(await openManifest(row.ciphertext, dek)), name };
    const response = await request<FileRecord>({
      method: 'PUT',
      path: `/files/${canonical}/manifest`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: { ciphertext: await sealManifest(manifest, dek) },
    });

    return { record: response.data, manifest };
  } finally {
    zeroBytes(dek);
  }
}
