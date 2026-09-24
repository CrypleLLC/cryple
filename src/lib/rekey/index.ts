import { request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { listDocumentsMeta } from '@/lib/documents';
import { listFiles } from '@/lib/files';
import { scopeDekWrapper } from '@/lib/keyrings';
import { listNotesMeta } from '@/lib/notes';
import { listSecretsMeta } from '@/lib/secrets';
import { zeroBytes } from '@/lib/encoding';
import { ITEM_SCOPES, type ItemScope } from '@/lib/scopes';
import { normalizeActionArgs, signActionEnvelope } from '@/lib/signing';

export const REKEY_BATCH_SIZE = 100;

export interface WrappedItem {
  id: string;
  wrapped_dek: string;
  key_generation: number;
}

export interface RekeyOutcome {
  scope: ItemScope;
  requested: number;
  rekeyed: number;
}

interface RekeyResponse {
  requested: number;
  rekeyed: number;
}

const ACTION_BY_SCOPE = {
  secrets: 'secret-rekey',
  notes: 'note-rekey',
  documents: 'document-rekey',
  files: 'file-rekey',
} as const satisfies Record<ItemScope, string>;

async function listWrapped(context: AuthedContext, scope: ItemScope): Promise<WrappedItem[]> {
  switch (scope) {
    case 'secrets':
      return listSecretsMeta(context);
    case 'notes':
      return listNotesMeta(context);
    case 'documents':
      return listDocumentsMeta(context);
    case 'files':
      return (await listFiles(context)).filter((file) => file.r2_state === 'ok');
  }
}

export function staleItems(items: readonly WrappedItem[], generation: number): WrappedItem[] {
  return items
    .filter((item) => item.key_generation < generation)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function batched<T>(items: readonly T[], size = REKEY_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) {
    batches.push(items.slice(at, at + size));
  }
  return batches;
}

async function rewrapBatch(
  context: AuthedContext,
  scope: ItemScope,
  batch: readonly WrappedItem[],
): Promise<RekeyResponse> {
  const wrapper = scopeDekWrapper(context, scope);
  const items: { id: string; wrapped_dek: string }[] = [];
  let generation = 0;

  for (const item of batch) {
    const dek = await wrapper.unwrapDek(item);
    try {
      const wrapped = await wrapper.wrapDek(dek);
      generation = wrapped.key_generation;
      items.push({ id: item.id, wrapped_dek: wrapped.wrapped_dek });
    } finally {
      zeroBytes(dek);
    }
  }

  const action = ACTION_BY_SCOPE[scope];
  const normalized = normalizeActionArgs(
    action,
    items.map((item) => item.id),
  );
  const envelope = await signActionEnvelope(action, normalized, context.session.signer());

  const response = await request<RekeyResponse>({
    method: 'PUT',
    path: `/${scope}/keys`,
    token: requireToken(context),
    body: { key_generation: generation, items, ...envelope },
  });

  return response.data;
}

export async function rewrapScope(
  context: AuthedContext,
  scope: ItemScope,
): Promise<RekeyOutcome> {
  const { generation } = context.session.currentKek(scope);
  const stale = staleItems(await listWrapped(context, scope), generation);

  let rekeyed = 0;
  for (const batch of batched(stale)) {
    const result = await rewrapBatch(context, scope, batch);
    rekeyed += result.rekeyed;
  }

  return { scope, requested: stale.length, rekeyed };
}

export async function rewrapAfterRotation(
  context: AuthedContext,
  scopes: readonly string[],
): Promise<RekeyOutcome[]> {
  const wanted = ITEM_SCOPES.filter(
    (scope) => scopes.includes(scope) && context.session.holds(scope),
  );

  const outcomes: RekeyOutcome[] = [];
  for (const scope of wanted) {
    outcomes.push(await rewrapScope(context, scope));
  }

  return outcomes;
}
