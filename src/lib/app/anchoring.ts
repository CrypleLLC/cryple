import type { SecretRecord } from '@/lib/secrets';
import type { NoteMetaRecord, NoteRecord } from '@/lib/notes';
import type { DocumentMetaRecord, DocumentRecord } from '@/lib/documents';
import { prove, vaultRootHex, verifyProof, type VaultItem } from '@/lib/vaultmerkle';
import { hexToBytes } from '@/lib/encoding';

export type LeafCacheKey = string;

export interface CachedLeaf {
  key: LeafCacheKey;
  item: VaultItem;
}

export interface DocumentAnchorState {
  id: string;
  compacted: boolean;
  pendingChanges: boolean;
}

export interface VaultCollection {
  items: VaultItem[];
  documentsNeedingCompaction: string[];
  documentsExcluded: string[];
  notesToFetch: string[];
}

export const NOT_YET_PROTECTED =
  'Recent changes are not protected yet. They become verifiable after the next save completes.';

export const NEVER_PROTECTED =
  'This document has never been saved in a protected form, so an heir cannot verify it.';

export function secretItems(secrets: readonly SecretRecord[]): VaultItem[] {
  return secrets.map((secret) => ({ type: 'secret', id: secret.id, blob: secret.ciphertext }));
}

export function noteItems(notes: readonly NoteRecord[]): VaultItem[] {
  return notes.map((note) => ({ type: 'note', id: note.id, blob: note.ciphertext }));
}

export function documentItem(document: DocumentRecord): VaultItem | undefined {
  if (document.snapshot_ciphertext.length === 0) {
    return undefined;
  }
  return { type: 'document', id: document.id, blob: document.snapshot_ciphertext };
}

export function documentAnchorState(meta: DocumentMetaRecord): DocumentAnchorState {
  return {
    id: meta.id,
    compacted: meta.snapshot_seq > 0,
    pendingChanges: meta.latest_seq > meta.snapshot_seq,
  };
}

export function documentsNeedingCompaction(
  meta: readonly DocumentMetaRecord[],
): DocumentMetaRecord[] {
  return meta.filter((entry) => entry.latest_seq > entry.snapshot_seq);
}

export function documentsWithoutLeaf(meta: readonly DocumentMetaRecord[]): DocumentMetaRecord[] {
  return meta.filter((entry) => entry.snapshot_seq === 0 && entry.latest_seq === 0);
}

export function isVerifiable(meta: DocumentMetaRecord): boolean {
  return meta.snapshot_seq > 0 && meta.latest_seq === meta.snapshot_seq;
}

export function documentStateMessage(meta: DocumentMetaRecord): string | undefined {
  if (meta.snapshot_seq === 0) {
    return NEVER_PROTECTED;
  }
  if (meta.latest_seq > meta.snapshot_seq) {
    return NOT_YET_PROTECTED;
  }
  return undefined;
}

export function secretCacheKey(secret: { id: string; updated_at: string }): LeafCacheKey {
  return `secret|${secret.id}|${secret.updated_at}`;
}

export function noteCacheKey(note: { id: string; updated_at: string }): LeafCacheKey {
  return `note|${note.id}|${note.updated_at}`;
}

export function documentCacheKey(document: { id: string; revision: number }): LeafCacheKey {
  return `document|${document.id}|${document.revision}`;
}

export function notesNeedingFetch(
  meta: readonly NoteMetaRecord[],
  cached: ReadonlyMap<LeafCacheKey, VaultItem>,
): NoteMetaRecord[] {
  return meta.filter((entry) => !cached.has(noteCacheKey(entry)));
}

export function cachedNoteItems(
  meta: readonly NoteMetaRecord[],
  cached: ReadonlyMap<LeafCacheKey, VaultItem>,
): VaultItem[] {
  return meta
    .map((entry) => cached.get(noteCacheKey(entry)))
    .filter((item): item is VaultItem => item !== undefined);
}

export function pruneCache(
  cached: ReadonlyMap<LeafCacheKey, VaultItem>,
  liveKeys: readonly LeafCacheKey[],
): Map<LeafCacheKey, VaultItem> {
  const live = new Set(liveKeys);
  return new Map([...cached].filter(([key]) => live.has(key)));
}

export interface VaultSources {
  listSecrets(): Promise<readonly SecretRecord[]>;
  listNotesMeta(): Promise<readonly NoteMetaRecord[]>;
  getNote(id: string): Promise<NoteRecord>;
  listDocumentsMeta(): Promise<readonly DocumentMetaRecord[]>;
  getDocument(id: string): Promise<DocumentRecord>;
}

export interface CollectOptions {
  cache?: ReadonlyMap<LeafCacheKey, VaultItem>;
  onProgress?: (progress: CollectProgress) => void;
}

export interface CollectProgress {
  stage: 'secrets' | 'notes' | 'documents';
  fetched: number;
  total: number;
}

export interface CollectedVault {
  items: VaultItem[];
  cache: Map<LeafCacheKey, VaultItem>;
  pendingDocuments: string[];
  excludedDocuments: string[];
}

export class NothingToAnchorError extends Error {
  constructor() {
    super('there is nothing in this vault to protect yet');
    this.name = 'NothingToAnchorError';
  }
}

export async function collectVault(
  sources: VaultSources,
  options: CollectOptions = {},
): Promise<CollectedVault> {
  const cache = new Map<LeafCacheKey, VaultItem>(options.cache ?? []);
  const items: VaultItem[] = [];
  const liveKeys: LeafCacheKey[] = [];

  const secrets = await sources.listSecrets();
  options.onProgress?.({ stage: 'secrets', fetched: secrets.length, total: secrets.length });
  for (const secret of secrets) {
    const item: VaultItem = { type: 'secret', id: secret.id, blob: secret.ciphertext };
    const key = secretCacheKey(secret);
    cache.set(key, item);
    liveKeys.push(key);
    items.push(item);
  }

  const noteMeta = await sources.listNotesMeta();
  let fetched = 0;
  for (const entry of noteMeta) {
    const key = noteCacheKey(entry);
    liveKeys.push(key);

    const hit = cache.get(key);
    if (hit) {
      items.push(hit);
      continue;
    }

    const note = await sources.getNote(entry.id);
    const item: VaultItem = { type: 'note', id: note.id, blob: note.ciphertext };
    cache.set(key, item);
    items.push(item);
    fetched += 1;
    options.onProgress?.({ stage: 'notes', fetched, total: noteMeta.length });
  }

  const documentMeta = await sources.listDocumentsMeta();
  const pendingDocuments: string[] = [];
  const excludedDocuments: string[] = [];

  for (const entry of documentMeta) {
    if (entry.snapshot_seq === 0) {
      excludedDocuments.push(entry.id);
      continue;
    }
    if (entry.latest_seq > entry.snapshot_seq) {
      pendingDocuments.push(entry.id);
    }

    const key = documentCacheKey(entry);
    liveKeys.push(key);

    const hit = cache.get(key);
    if (hit) {
      items.push(hit);
      continue;
    }

    const document = await sources.getDocument(entry.id);
    const item = documentItem(document);
    if (item === undefined) {
      excludedDocuments.push(entry.id);
      continue;
    }

    cache.set(key, item);
    items.push(item);
  }

  if (items.length === 0) {
    throw new NothingToAnchorError();
  }

  return {
    items,
    cache: pruneCache(cache, liveKeys),
    pendingDocuments,
    excludedDocuments,
  };
}

export interface AnchorPassOptions extends CollectOptions {
  compactDocument?: (id: string) => Promise<void>;
}

export interface AnchorPass {
  root: string;
  items: VaultItem[];
  cache: Map<LeafCacheKey, VaultItem>;
  compacted: string[];
  pendingDocuments: string[];
  excludedDocuments: string[];
}

export type VaultAnchorState =
  | { state: 'anchored'; epoch: number; root: string }
  | { state: 'stale'; currentRoot: string; anchoredEpoch?: number; anchoredRoot?: string }
  | { state: 'never'; currentRoot: string }
  | { state: 'unverified'; anchoredEpoch: number };

export async function runAnchorPass(
  sources: VaultSources,
  options: AnchorPassOptions = {},
): Promise<AnchorPass> {
  const compacted: string[] = [];

  if (options.compactDocument) {
    for (const entry of documentsNeedingCompaction(await sources.listDocumentsMeta())) {
      await options.compactDocument(entry.id);
      compacted.push(entry.id);
    }
  }

  const collected = await collectVault(sources, options);

  return {
    root: vaultRootHex(collected.items),
    items: collected.items,
    cache: collected.cache,
    compacted,
    pendingDocuments: collected.pendingDocuments,
    excludedDocuments: collected.excludedDocuments,
  };
}

export function vaultAnchorState(
  currentRoot: string,
  anchored: { epoch: number; root: string } | undefined,
  epoch: number,
): VaultAnchorState {
  if (anchored === undefined) {
    return { state: 'never', currentRoot };
  }

  if (anchored.epoch === epoch && anchored.root.toLowerCase() === currentRoot.toLowerCase()) {
    return { state: 'anchored', epoch, root: currentRoot };
  }

  return {
    state: 'stale',
    currentRoot,
    anchoredEpoch: anchored.epoch,
    anchoredRoot: anchored.root,
  };
}

export interface VaultProtectionView {
  tone: 'ok' | 'attention';
  headline: string;
  detail?: string;
  actionLabel: string;
  needsAnchor: boolean;
}

export const PROTECTION_HEADLINE_OK = 'Your vault is protected';
export const PROTECTION_HEADLINE_STALE = 'Your recent changes are not protected yet';
export const PROTECTION_HEADLINE_NEVER = 'Your vault is not protected yet';

export function buildProtectionView(
  state: VaultAnchorState,
  pendingDocuments: readonly string[] = [],
  excludedDocuments: readonly string[] = [],
): VaultProtectionView {
  const caveats: string[] = [];
  if (pendingDocuments.length > 0) {
    caveats.push(
      `${pendingDocuments.length} document${pendingDocuments.length === 1 ? '' : 's'} ${
        pendingDocuments.length === 1 ? 'has' : 'have'
      } unsaved changes that are not covered yet.`,
    );
  }
  if (excludedDocuments.length > 0) {
    caveats.push(
      `${excludedDocuments.length} document${excludedDocuments.length === 1 ? ' has' : 's have'} never been saved, so ${
        excludedDocuments.length === 1 ? 'it is' : 'they are'
      } not covered.`,
    );
  }

  const detail = caveats.length > 0 ? caveats.join(' ') : undefined;

  if (state.state === 'unverified') {
    return {
      tone: 'ok',
      headline: `Last protected ${epochDate(state.anchoredEpoch).toLocaleDateString()}`,
      ...(detail === undefined ? {} : { detail }),
      actionLabel: 'Protect my vault',
      needsAnchor: true,
    };
  }

  if (state.state === 'anchored') {
    return {
      tone: caveats.length > 0 ? 'attention' : 'ok',
      headline: PROTECTION_HEADLINE_OK,
      ...(detail === undefined ? {} : { detail }),
      actionLabel: 'Protect again',
      needsAnchor: false,
    };
  }

  return {
    tone: 'attention',
    headline:
      state.state === 'never' ? PROTECTION_HEADLINE_NEVER : PROTECTION_HEADLINE_STALE,
    ...(detail === undefined ? {} : { detail }),
    actionLabel: 'Protect my vault',
    needsAnchor: true,
  };
}

export function epochDate(epoch: number): Date {
  return new Date(epoch * 86_400 * 1000);
}

export interface VaultSourceContext {
  listSecrets(): Promise<readonly SecretRecord[]>;
  listNotesMeta(): Promise<readonly NoteMetaRecord[]>;
  getNote(id: string): Promise<NoteRecord>;
  listDocumentsMeta(): Promise<readonly DocumentMetaRecord[]>;
  getDocument(id: string): Promise<DocumentRecord>;
}

export function vaultSources(context: VaultSourceContext): VaultSources {
  return context;
}

export interface ItemVerification {
  type: VaultItem['type'];
  id: string;
  verified: boolean;
}

export function verifyVaultAgainstRoot(
  items: readonly VaultItem[],
  chainRoot: string,
): ItemVerification[] {
  const root = hexToBytes(chainRoot.replace(/^0x/, ''));

  return items.map((item) => ({
    type: item.type,
    id: item.id,
    verified: verifyProof(prove(items, item.type, item.id), root),
  }));
}

export function allVerified(results: readonly ItemVerification[]): boolean {
  return results.length > 0 && results.every((result) => result.verified);
}
