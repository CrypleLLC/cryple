import { request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { listCredentialsMeta } from '@/lib/credentials';
import { listDocumentsMeta } from '@/lib/documents';
import { listFiles } from '@/lib/files';
import { scopeDekWrapper } from '@/lib/keyrings';
import { listNotesMeta } from '@/lib/notes';
import { listSecretsMeta } from '@/lib/secrets';
import { zeroBytes } from '@/lib/encoding';
import { DEK_SCOPES, type DekScope } from '@/lib/scopes';
import { normalizeActionArgs, signActionEnvelope, type DeviceActionLabel } from '@/lib/signing';

export const REKEY_BATCH_SIZE = 100;

export interface WrappedItem {
  id: string;
  wrapped_dek: string;
  key_generation: number;
}

export interface RekeyOutcome {
  scope: DekScope;
  requested: number;
  rekeyed: number;
}

interface RekeyResponse {
  requested: number;
  rekeyed: number;
}

interface RekeyRoute {
  path: string;
  action: DeviceActionLabel;
  idField: 'id' | 'revision_id';
  list: (context: AuthedContext) => Promise<WrappedItem[]>;
}

const ROUTES = {
  secrets: {
    path: '/secrets/keys',
    action: 'secret-rekey',
    idField: 'id',
    list: (context) => listSecretsMeta(context),
  },
  notes: {
    path: '/notes/keys',
    action: 'note-rekey',
    idField: 'id',
    list: (context) => listNotesMeta(context),
  },
  documents: {
    path: '/documents/keys',
    action: 'document-rekey',
    idField: 'id',
    list: (context) => listDocumentsMeta(context),
  },
  files: {
    path: '/files/keys',
    action: 'file-rekey',
    idField: 'id',
    list: async (context) => (await listFiles(context)).filter((file) => file.r2_state === 'ok'),
  },
  passwords: {
    path: '/credentials/keys',
    action: 'credential-rekey',
    idField: 'revision_id',
    list: async (context) =>
      (await listCredentialsMeta(context)).map((meta) => ({
        id: meta.revision_id,
        wrapped_dek: meta.wrapped_dek,
        key_generation: meta.key_generation,
      })),
  },
} as const satisfies Record<DekScope, RekeyRoute>;

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
  scope: DekScope,
  batch: readonly WrappedItem[],
): Promise<RekeyResponse> {
  const route: RekeyRoute = ROUTES[scope];
  const wrapper = scopeDekWrapper(context, scope);
  const items: Record<string, string>[] = [];
  let generation = 0;

  for (const item of batch) {
    const dek = await wrapper.unwrapDek(item);
    try {
      const wrapped = await wrapper.wrapDek(dek);
      generation = wrapped.key_generation;
      items.push({ [route.idField]: item.id, wrapped_dek: wrapped.wrapped_dek });
    } finally {
      zeroBytes(dek);
    }
  }

  const normalized = normalizeActionArgs(
    route.action,
    batch.map((item) => item.id),
  );
  const envelope = await signActionEnvelope(route.action, normalized, context.session.signer());

  const response = await request<RekeyResponse>({
    method: 'PUT',
    path: route.path,
    token: requireToken(context),
    body: { key_generation: generation, items, ...envelope },
  });

  return response.data;
}

export async function rewrapScope(context: AuthedContext, scope: DekScope): Promise<RekeyOutcome> {
  const { generation } = context.session.currentKek(scope);
  const stale = staleItems(await ROUTES[scope].list(context), generation);

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
  const wanted = DEK_SCOPES.filter(
    (scope) => scopes.includes(scope) && context.session.holds(scope),
  );

  const outcomes: RekeyOutcome[] = [];
  for (const scope of wanted) {
    outcomes.push(await rewrapScope(context, scope));
  }

  return outcomes;
}
