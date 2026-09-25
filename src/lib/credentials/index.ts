import { assertCanonicalUuid, request } from '@/lib/api';
import { normalizeActionArgs, signActionEnvelope } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { scopeDekWrapper, withCurrentGeneration } from '@/lib/keyrings';
import { generateDek, type DekWrapper } from './dek';
import { openText, sealText } from './codec';

export const MAX_PLAINTEXT_BYTES = 24 * 1024;
export const CREDENTIAL_VERSION = 'v1';
export const SYNC_PAGE_SIZE = 200;

export interface CredentialSummary {
  credential_id: string;
  revision_id: string;
  seq: number;
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  version: string;
  created_at: string;
}

export interface CredentialMeta {
  credential_id: string;
  revision_id: string;
  wrapped_dek: string;
  key_generation: number;
  created_at: string;
}

export interface CredentialRevision extends CredentialSummary {
  deleted: boolean;
}

export interface CredentialSyncPage {
  revisions: CredentialRevision[];
  cursor: number;
  has_more: boolean;
}

export interface CredentialsContext extends AuthedContext {
  dek?: DekWrapper;
}

function wrapper(context: CredentialsContext): DekWrapper {
  return context.dek ?? scopeDekWrapper(context, 'passwords');
}

export interface WriteCredentialResult {
  revision: CredentialSummary;
  created: boolean;
}

export async function writeCredential(
  context: CredentialsContext,
  plaintext: string,
  options: { credentialId?: string; revisionId?: string } = {},
): Promise<WriteCredentialResult> {
  const bytes = new TextEncoder().encode(plaintext).length;
  if (bytes > MAX_PLAINTEXT_BYTES) {
    throw new Error(
      `plaintext is ${bytes} bytes, over the ${MAX_PLAINTEXT_BYTES}-byte per-credential budget`,
    );
  }

  const credentialId =
    options.credentialId === undefined
      ? crypto.randomUUID()
      : assertCanonicalUuid(options.credentialId);
  const revisionId =
    options.revisionId === undefined ? crypto.randomUUID() : assertCanonicalUuid(options.revisionId);
  const dek = generateDek();

  try {
    const ciphertext = await sealText(plaintext, dek);

    const response = await withCurrentGeneration(context, async () =>
      request<CredentialSummary>({
        method: 'POST',
        path: '/credentials',
        token: requireToken(context),
        timeoutMs: context.timeoutMs,
        body: {
          credential_id: credentialId,
          revision_id: revisionId,
          ciphertext,
          ...(await wrapper(context).wrapDek(dek)),
          version: CREDENTIAL_VERSION,
        },
      }),
    );

    return { revision: response.data, created: response.status === 201 };
  } finally {
    zeroBytes(dek);
  }
}

export async function listCredentials(
  context: CredentialsContext,
): Promise<CredentialSummary[]> {
  const response = await request<CredentialSummary[]>({
    method: 'GET',
    path: '/credentials',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data ?? [];
}

export async function listCredentialsMeta(
  context: CredentialsContext,
): Promise<CredentialMeta[]> {
  const response = await request<CredentialMeta[]>({
    method: 'GET',
    path: '/credentials',
    query: { fields: 'meta' },
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data ?? [];
}

export async function getCredential(
  context: CredentialsContext,
  credentialId: string,
): Promise<CredentialSummary> {
  const response = await request<CredentialSummary>({
    method: 'GET',
    path: `/credentials/${assertCanonicalUuid(credentialId)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function syncCredentials(
  context: CredentialsContext,
  cursor = 0,
  limit = SYNC_PAGE_SIZE,
): Promise<CredentialSyncPage> {
  const response = await request<CredentialSyncPage>({
    method: 'GET',
    path: '/credentials/sync',
    query: { cursor: String(cursor), limit: String(limit) },
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function listRevisions(
  context: CredentialsContext,
  credentialId: string,
): Promise<CredentialRevision[]> {
  const response = await request<CredentialRevision[]>({
    method: 'GET',
    path: `/credentials/${assertCanonicalUuid(credentialId)}/revisions`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data ?? [];
}

export async function syncAllRevisions(context: CredentialsContext): Promise<CredentialRevision[]> {
  const revisions: CredentialRevision[] = [];
  let cursor = 0;
  for (;;) {
    const page = await syncCredentials(context, cursor);
    revisions.push(...page.revisions);
    if (!page.has_more || page.cursor <= cursor) {
      return revisions;
    }
    cursor = page.cursor;
  }
}

export interface DeletedCredential {
  credentialId: string;
  deletedAt: string;
  lastLive: CredentialRevision;
}

export function deletedCredentials(revisions: readonly CredentialRevision[]): DeletedCredential[] {
  const byCredential = new Map<string, CredentialRevision[]>();
  for (const revision of revisions) {
    const list = byCredential.get(revision.credential_id) ?? [];
    list.push(revision);
    byCredential.set(revision.credential_id, list);
  }
  const deleted: DeletedCredential[] = [];
  for (const [credentialId, list] of byCredential) {
    const ordered = [...list].sort((a, b) => b.seq - a.seq);
    const latest = ordered[0];
    const lastLive = ordered.find((revision) => !revision.deleted);
    if (latest.deleted && lastLive !== undefined) {
      deleted.push({ credentialId, deletedAt: latest.created_at, lastLive });
    }
  }
  return deleted.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function restoreCredential(
  context: CredentialsContext,
  deleted: DeletedCredential,
): Promise<WriteCredentialResult> {
  const plaintext = await openCredential(context, deleted.lastLive);
  return writeCredential(context, plaintext, { credentialId: deleted.credentialId });
}

export async function openCredential(
  context: CredentialsContext,
  revision: CredentialSummary,
): Promise<string> {
  const dek = await wrapper(context).unwrapDek(revision);
  try {
    return await openText(revision.ciphertext, dek);
  } finally {
    zeroBytes(dek);
  }
}

export async function deleteCredential(
  context: CredentialsContext,
  credentialId: string,
): Promise<void> {
  const canonical = assertCanonicalUuid(credentialId);

  const envelope = await signActionEnvelope(
    'credential-delete',
    [canonical],
    context.session.signer(),
  );

  await request<void>({
    method: 'DELETE',
    path: `/credentials/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export interface BatchDeleteResult {
  requested: number;
  tombstoned: number;
}

export async function deleteCredentials(
  context: CredentialsContext,
  credentialIds: readonly string[],
): Promise<BatchDeleteResult> {
  const canonical = credentialIds.map((id) => assertCanonicalUuid(id));
  const normalized = normalizeActionArgs('credential-delete', canonical);

  const envelope = await signActionEnvelope(
    'credential-delete',
    normalized,
    context.session.signer(),
  );

  const response = await request<BatchDeleteResult>({
    method: 'DELETE',
    path: '/credentials',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ids: normalized, ...envelope },
  });

  return response.data;
}

export interface PruneResult {
  pruned: number;
}

export async function pruneCredential(
  context: CredentialsContext,
  credentialId: string,
  keepLast: number,
): Promise<PruneResult> {
  const canonical = assertCanonicalUuid(credentialId);

  const envelope = await signActionEnvelope(
    'credential-prune',
    [canonical, String(keepLast)],
    context.session.signer(),
  );

  const response = await request<PruneResult>({
    method: 'POST',
    path: `/credentials/${canonical}/prune`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { keep_last: keepLast, ...envelope },
  });

  return response.data;
}

export * from './dek';
export * from './codec';
