import { assertCanonicalUuid, request } from '@/lib/api';
import { normalizeActionArgs, signActionEnvelope } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';
import { sha256Hex, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { scopeDekWrapper, withCurrentGeneration } from '@/lib/keyrings';
import { generateDek, type DekWrapper } from './dek';
import { openText, sealText } from './codec';

export const MAX_PLAINTEXT_BYTES = 700 * 1024;
export const SECRET_VERSION = 'v1';

export interface SecretRecord {
  id: string;
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface SecretMetaRecord {
  id: string;
  ciphertext_sha256: string;
  ciphertext_bytes: number;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface SecretsContext extends AuthedContext {
  dek?: DekWrapper;
}

function wrapper(context: SecretsContext): DekWrapper {
  return context.dek ?? scopeDekWrapper(context, 'secrets');
}

export interface CreateSecretResult {
  secret: SecretRecord;
  created: boolean;
}

export async function createSecret(
  context: SecretsContext,
  plaintext: string,
  options: { id?: string } = {},
): Promise<CreateSecretResult> {
  const bytes = new TextEncoder().encode(plaintext).length;
  if (bytes > MAX_PLAINTEXT_BYTES) {
    throw new Error(
      `plaintext is ${bytes} bytes, over the ${MAX_PLAINTEXT_BYTES}-byte per-item budget`,
    );
  }

  const id = options.id === undefined ? crypto.randomUUID() : assertCanonicalUuid(options.id);
  const dek = generateDek();

  try {
    const ciphertext = await sealText(plaintext, dek);

    const response = await withCurrentGeneration(context, async () =>
      request<SecretRecord>({
        method: 'POST',
        path: '/secrets',
        token: requireToken(context),
        timeoutMs: context.timeoutMs,
        body: { id, ciphertext, ...(await wrapper(context).wrapDek(dek)), version: SECRET_VERSION },
      }),
    );

    return { secret: response.data, created: response.status === 201 };
  } finally {
    zeroBytes(dek);
  }
}

export async function listSecretsMeta(
  context: SecretsContext,
): Promise<SecretMetaRecord[]> {
  const response = await request<SecretMetaRecord[]>({
    method: 'GET',
    path: '/secrets',
    query: { fields: 'meta' },
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data ?? [];
}

export async function listSecrets(context: SecretsContext): Promise<SecretRecord[]> {
  const response = await request<SecretRecord[]>({
    method: 'GET',
    path: '/secrets',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data ?? [];
}

export async function getSecret(
  context: SecretsContext,
  id: string,
): Promise<SecretRecord> {
  const response = await request<SecretRecord>({
    method: 'GET',
    path: `/secrets/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function openSecret(
  context: SecretsContext,
  secret: SecretRecord,
): Promise<string> {
  const dek = await wrapper(context).unwrapDek(secret);
  try {
    return await openText(secret.ciphertext, dek);
  } finally {
    zeroBytes(dek);
  }
}

export async function hashReceivedCiphertext(ciphertext: string): Promise<string> {
  return sha256Hex(utf8ToBytes(ciphertext));
}

export async function deleteSecret(context: SecretsContext, id: string): Promise<void> {
  const canonical = assertCanonicalUuid(id);

  const envelope = await signActionEnvelope('secret-delete', [canonical], context.session.signer());

  await request<void>({
    method: 'DELETE',
    path: `/secrets/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export interface BatchDeleteResult {
  requested: number;
  deleted: number;
}

export async function deleteSecrets(
  context: SecretsContext,
  ids: readonly string[],
): Promise<BatchDeleteResult> {
  const canonical = ids.map((id) => assertCanonicalUuid(id));
  const normalized = normalizeActionArgs('secret-delete', canonical);

  const envelope = await signActionEnvelope('secret-delete', normalized, context.session.signer());

  const response = await request<BatchDeleteResult>({
    method: 'DELETE',
    path: '/secrets',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ids: normalized, ...envelope },
  });

  return response.data;
}

export * from './dek';
export * from './codec';
