import { ApiError, request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { sha256Hex, utf8ToBytes } from '@/lib/encoding';
import { signActionEnvelope } from '@/lib/signing';

export const MANIFEST_SCOPES = ['secrets', 'notes'] as const;
export type ManifestScope = (typeof MANIFEST_SCOPES)[number];

export interface FolderManifestRecord {
  scope: ManifestScope;
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  revision: number;
  updated_at: string;
}

export interface PutFolderManifestInput {
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  expected_revision: number;
}

export async function getFolderManifest(
  context: AuthedContext,
  scope: ManifestScope,
): Promise<FolderManifestRecord | undefined> {
  try {
    const response = await request<FolderManifestRecord>({
      method: 'GET',
      path: `/${scope}/folders`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
    });
    return response.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export async function putFolderManifest(
  context: AuthedContext,
  scope: ManifestScope,
  input: PutFolderManifestInput,
): Promise<FolderManifestRecord> {
  const digest = await sha256Hex(utf8ToBytes(input.ciphertext));
  const response = await request<FolderManifestRecord>({
    method: 'PUT',
    path: `/${scope}/folders`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      ...input,
      ...(await signActionEnvelope(
        'folders-update',
        [scope, input.expected_revision, digest],
        context.session.signer(),
      )),
    },
  });
  return response.data;
}
