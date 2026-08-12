import { assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { normalizeActionArgs, signActionEnvelope } from '@/lib/signing';
import { generateDek, vaultKekDekWrapper, type DekWrapper } from '@/lib/secrets';
import { zeroBytes } from '@/lib/encoding';
import {
  DOCUMENT_MAX_BODY_BYTES,
  DOCUMENT_VERSION,
  MAX_UPDATES_PER_REQUEST,
  MAX_UPDATE_CHARACTERS,
  assertContiguous,
  type AppendResult,
  type DocumentMetaRecord,
  type DocumentRecord,
  type DocumentUpdateRecord,
  type PendingUpdate,
} from './records';

export interface DocumentsContext extends AuthedContext {
  dek?: DekWrapper;
}

export function wrapper(context: DocumentsContext): DekWrapper {
  return context.dek ?? vaultKekDekWrapper(context.session.vaultKek);
}

export interface CreateDocumentResult {
  document: DocumentRecord;
  created: boolean;
}

export async function createDocument(
  context: DocumentsContext,
  options: { id?: string } = {},
): Promise<CreateDocumentResult> {
  const id = options.id === undefined ? crypto.randomUUID() : assertCanonicalUuid(options.id);
  const dek = generateDek();

  try {
    const wrapped_dek = await wrapper(context).wrapDek(dek);

    const response = await request<DocumentRecord>({
      method: 'POST',
      path: '/documents',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: { id, wrapped_dek, version: DOCUMENT_VERSION },
    });

    return { document: response.data, created: response.status === 201 };
  } finally {
    zeroBytes(dek);
  }
}

export async function listDocumentsMeta(
  context: DocumentsContext,
  options: { limit?: number } = {},
): Promise<DocumentMetaRecord[]> {
  return collectPages<DocumentMetaRecord>(
    (page: PageRequest) =>
      request<DocumentMetaRecord[]>({
        method: 'GET',
        path: '/documents',
        query: { limit: page.limit, cursor: page.cursor },
        token: requireToken(context),
        timeoutMs: context.timeoutMs,
      }),
    { limit: options.limit },
  );
}

export async function getDocument(
  context: DocumentsContext,
  id: string,
): Promise<DocumentRecord> {
  const response = await request<DocumentRecord>({
    method: 'GET',
    path: `/documents/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function listUpdatesSince(
  context: DocumentsContext,
  id: string,
  since: number,
  options: { limit?: number; expectFollowing?: boolean } = {},
): Promise<DocumentUpdateRecord[]> {
  const canonical = assertCanonicalUuid(id);
  if (!Number.isInteger(since) || since < 0) {
    throw new Error(`since must be a non-negative integer, got ${since}`);
  }

  const updates = await collectPages<DocumentUpdateRecord>(
    (page: PageRequest) =>
      request<DocumentUpdateRecord[]>({
        method: 'GET',
        path: `/documents/${canonical}/updates`,
        query: { since, limit: page.limit, cursor: page.cursor },
        token: requireToken(context),
        timeoutMs: context.timeoutMs,
      }),
    { limit: options.limit },
  );

  assertContiguous(updates, options.expectFollowing === false ? {} : { after: since });
  return updates;
}

export async function appendUpdates(
  context: DocumentsContext,
  id: string,
  updates: readonly PendingUpdate[],
): Promise<AppendResult> {
  if (updates.length === 0) {
    throw new Error('appendUpdates needs at least one update');
  }
  if (updates.length > MAX_UPDATES_PER_REQUEST) {
    throw new Error(
      `batch of ${updates.length} updates exceeds the server ceiling of ${MAX_UPDATES_PER_REQUEST}`,
    );
  }
  for (const update of updates) {
    assertCanonicalUuid(update.client_update_id);
    if (update.ciphertext.length > MAX_UPDATE_CHARACTERS) {
      throw new Error(
        `sealed update is ${update.ciphertext.length} characters, over the server ceiling of ${MAX_UPDATE_CHARACTERS}`,
      );
    }
  }

  const response = await request<AppendResult>({
    method: 'POST',
    path: `/documents/${assertCanonicalUuid(id)}/updates`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    maxBodyBytes: DOCUMENT_MAX_BODY_BYTES,
    body: { updates },
  });

  return response.data;
}

export interface CompactRequest {
  snapshot_ciphertext: string;
  through_seq: number;
  expected_revision?: number;
}

export async function compactDocument(
  context: DocumentsContext,
  id: string,
  body: CompactRequest,
): Promise<DocumentRecord> {
  const response = await request<DocumentRecord>({
    method: 'POST',
    path: `/documents/${assertCanonicalUuid(id)}/compact`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    maxBodyBytes: DOCUMENT_MAX_BODY_BYTES,
    body,
  });
  return response.data;
}

export async function rotateDocumentKey(
  context: DocumentsContext,
  id: string,
  wrapped_dek: string,
  expected_revision?: number,
): Promise<DocumentRecord> {
  const response = await request<DocumentRecord>({
    method: 'PUT',
    path: `/documents/${assertCanonicalUuid(id)}/key`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { wrapped_dek, expected_revision },
  });
  return response.data;
}

export async function deleteDocument(context: DocumentsContext, id: string): Promise<void> {
  const canonical = assertCanonicalUuid(id);

  const envelope = signActionEnvelope(
    'document-delete',
    [canonical],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  await request<void>({
    method: 'DELETE',
    path: `/documents/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export interface BatchDeleteDocumentsResult {
  requested: number;
  deleted: number;
}

export async function deleteDocuments(
  context: DocumentsContext,
  ids: readonly string[],
): Promise<BatchDeleteDocumentsResult> {
  const canonical = ids.map((id) => assertCanonicalUuid(id));
  const normalized = normalizeActionArgs('document-delete', canonical);

  const envelope = signActionEnvelope(
    'document-delete',
    normalized,
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<BatchDeleteDocumentsResult>({
    method: 'DELETE',
    path: '/documents',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ids: normalized, ...envelope },
  });

  return response.data;
}
