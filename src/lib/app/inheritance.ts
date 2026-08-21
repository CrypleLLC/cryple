import { getDocument, listDocumentsMeta, loadDocumentSummaries } from '@/lib/documents';
import type { DocumentRecord, DocumentSummary, DocumentsContext } from '@/lib/documents';
import { listNotes, openNote, type NotesContext } from '@/lib/notes';
import { listSecrets, openSecret, type SecretsContext } from '@/lib/secrets';
import {
  ITEM_TYPES,
  type Beneficiary,
  type InheritableItem,
  type InheritanceShare,
  type ItemType,
} from '@/lib/succession';
import { decodeSecretPayload, UNREADABLE_SECRET_NAME, type OpenedSecret } from './vault';
import { noteTitle, UNREADABLE_NOTE_TITLE, type OpenedNote } from './notes';
import { documentTitle, UNREADABLE_DOCUMENT_TITLE } from './documents';

export const UNTITLED_SECRET = 'Untitled item';

export const TYPE_LABELS: Record<ItemType, string> = {
  document: 'Documents',
  note: 'Notes',
  secret: 'Secrets',
};

export interface InheritanceCandidate {
  type: ItemType;
  id: string;
  title: string;
  updatedAt: string;
  assignable: boolean;
  wrappedDek: string;
}

export function candidateKey(candidate: Pick<InheritanceCandidate, 'type' | 'id'>): string {
  return `${candidate.type}|${candidate.id}`;
}

export function toInheritableItem(candidate: InheritanceCandidate): InheritableItem {
  return { type: candidate.type, id: candidate.id, wrappedDek: candidate.wrappedDek };
}

// A document has no "opened" type yet: its title lives inside the CRDT, which
// loadDocumentSummaries reads, while the wrapped DEK lives on the record.
export interface OpenedDocument {
  record: DocumentRecord;
  summary: DocumentSummary;
}

export interface CandidateSources {
  secrets: readonly OpenedSecret[];
  notes: readonly OpenedNote[];
  documents: readonly OpenedDocument[];
}

export function secretCandidate({ record, plaintext }: OpenedSecret): InheritanceCandidate {
  const base = {
    type: 'secret' as const,
    id: record.id,
    updatedAt: record.updated_at,
    wrappedDek: record.wrapped_dek,
  };

  if (plaintext === undefined) {
    return { ...base, title: UNREADABLE_SECRET_NAME, assignable: false };
  }

  try {
    const name = decodeSecretPayload(plaintext).name.trim();
    return { ...base, title: name.length === 0 ? UNTITLED_SECRET : name, assignable: true };
  } catch {
    return { ...base, title: UNREADABLE_SECRET_NAME, assignable: false };
  }
}

export function noteCandidate({ record, plaintext }: OpenedNote): InheritanceCandidate {
  const base = {
    type: 'note' as const,
    id: record.id,
    updatedAt: record.updated_at,
    wrappedDek: record.wrapped_dek,
  };

  return plaintext === undefined
    ? { ...base, title: UNREADABLE_NOTE_TITLE, assignable: false }
    : { ...base, title: noteTitle(plaintext), assignable: true };
}

export function documentCandidate({ record, summary }: OpenedDocument): InheritanceCandidate {
  const base = {
    type: 'document' as const,
    id: record.id,
    updatedAt: summary.updatedAt,
    wrappedDek: record.wrapped_dek,
  };

  return summary.readable
    ? { ...base, title: documentTitle(summary.title), assignable: true }
    : { ...base, title: UNREADABLE_DOCUMENT_TITLE, assignable: false };
}

const TYPE_ORDER = new Map<ItemType, number>(ITEM_TYPES.map((type, index) => [type, index]));

export function buildInheritanceCandidates(sources: CandidateSources): InheritanceCandidate[] {
  return [
    ...sources.secrets.map(secretCandidate),
    ...sources.notes.map(noteCandidate),
    ...sources.documents.map(documentCandidate),
  ].sort(byTypeThenTitle);
}

function byTypeThenTitle(a: InheritanceCandidate, b: InheritanceCandidate): number {
  const byType = (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0);
  if (byType !== 0) {
    return byType;
  }

  const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

  return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
}

export interface CandidateGroup {
  type: ItemType;
  label: string;
  items: InheritanceCandidate[];
}

export function groupByType(candidates: readonly InheritanceCandidate[]): CandidateGroup[] {
  return ITEM_TYPES.map((type) => ({
    type,
    label: TYPE_LABELS[type],
    items: candidates.filter((candidate) => candidate.type === type),
  })).filter((group) => group.items.length > 0);
}

export function sharedItemIds(current: readonly InheritanceShare[]): Set<string> {
  return new Set(current.map((share) => share.item_id));
}

export function isAlreadyShared(
  current: readonly InheritanceShare[],
  candidate: InheritanceCandidate,
): boolean {
  return sharedItemIds(current).has(candidate.id);
}

export function itemsToAssign(
  candidates: readonly InheritanceCandidate[],
  selected: Iterable<string>,
  current: readonly InheritanceShare[],
): InheritanceCandidate[] {
  const wanted = new Set(selected);
  const held = sharedItemIds(current);

  return candidates.filter(
    (candidate) =>
      wanted.has(candidateKey(candidate)) && candidate.assignable && !held.has(candidate.id),
  );
}

export function selectableKeys(candidates: readonly InheritanceCandidate[]): string[] {
  return candidates.filter((candidate) => candidate.assignable).map(candidateKey);
}

export const TYPE_NAMES: Record<ItemType, string> = {
  document: 'Document',
  note: 'Note',
  secret: 'Secret',
};

export const MISSING_ITEM_TITLE = 'Item no longer in your vault';

export interface AssignedItem {
  shareId: string;
  itemId: string;
  type: ItemType;
  typeName: string;
  title: string;
  updatedAt?: string;
  /** False when nothing in the vault matches the share — see below. */
  present: boolean;
}

/**
 * Joins an heir's shares to the vault, because a share carries no title: the
 * server never learns one, so the only place a name exists is inside the
 * ciphertext this device just opened.
 *
 * A share with no matching item is shown rather than dropped. Deleting an item
 * deletes its shares in the same transaction, so this should be unreachable —
 * and that is exactly why a silent filter would be the wrong response to it. An
 * owner seeing a row they cannot explain is better than an owner told an heir
 * inherits less than the server says.
 */
export function buildAssignedItems(
  shares: readonly InheritanceShare[],
  candidates: readonly InheritanceCandidate[],
): AssignedItem[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return shares
    .map((share) => {
      const type = share.item_type;
      const candidate = byId.get(share.item_id);

      return {
        shareId: share.id,
        itemId: share.item_id,
        type,
        typeName: TYPE_NAMES[type] ?? type,
        title: candidate?.title ?? MISSING_ITEM_TITLE,
        ...(candidate === undefined ? {} : { updatedAt: candidate.updatedAt }),
        present: candidate !== undefined,
      };
    })
    .sort(
      (a, b) =>
        (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
        a.itemId.localeCompare(b.itemId),
    );
}

export interface HeirTab {
  id: string;
  label: string;
  itemCount: number;
  accountClosed: boolean;
}

export function buildHeirTabs(beneficiaries: readonly Beneficiary[]): HeirTab[] {
  return beneficiaries.map((beneficiary) => ({
    id: beneficiary.id,
    label: beneficiary.keys_rotated ? '(account closed)' : beneficiary.username,
    itemCount: beneficiary.share_count,
    accountClosed: beneficiary.keys_rotated,
  }));
}

/**
 * Which tab to show after the list changes.
 *
 * Keeps the current one when it survives, because a re-read must not move an
 * owner mid-task. Falls back to the first rather than to none: removing the
 * heir you were looking at should leave you looking at another one, not at a
 * blank panel that reads as though everything is gone.
 */
export function nextActiveTab(tabs: readonly HeirTab[], current?: string): string | undefined {
  if (current !== undefined && tabs.some((tab) => tab.id === current)) {
    return current;
  }

  return tabs[0]?.id;
}

/**
 * Says what actually goes, because the destructive part is invisible: the server
 * cascades the delete to every wrapped key under that heir, and those are the
 * one thing only the owner's client can regenerate.
 */
export function removeHeirConfirmation(username: string, assigned: number): string {
  const items =
    assigned === 0
      ? 'They inherit nothing yet, so nothing is lost'
      : `The ${assigned === 1 ? '1 item' : `${assigned} items`} they inherit go with them, and re-assigning means wrapping each one again`;

  return `Remove ${username} as an heir? ${items}. Your vault itself is untouched.`;
}

export const NO_HEIRS_YET =
  'Name someone first. Until you do there is nobody to leave anything to, and nothing here to set up.';

export const NOTHING_ASSIGNED_YET =
  'This heir inherits nothing yet. Choose what they get with Set inheritance.';

export interface AssignmentFailure {
  candidate: InheritanceCandidate;
  error: unknown;
}

export interface AssignmentOutcome {
  attempted: number;
  saved: InheritanceCandidate[];
  failed: AssignmentFailure[];
}

/**
 * Assigns each chosen item, one request at a time, and keeps going after a
 * failure.
 *
 * There is no batch endpoint and no transaction across these, so a run can
 * genuinely end up half-applied. Stopping at the first error would leave the
 * same half-applied state while reporting less about it, and every share that
 * did land is real and worth keeping.
 *
 * Sequential rather than parallel on purpose: each assignment signs an action,
 * and every signature needs its own fresh challenge.
 */
export async function assignSelection(
  items: readonly InheritanceCandidate[],
  assign: (item: InheritanceCandidate) => Promise<unknown>,
): Promise<AssignmentOutcome> {
  const saved: InheritanceCandidate[] = [];
  const failed: AssignmentFailure[] = [];

  for (const item of items) {
    try {
      await assign(item);
      saved.push(item);
    } catch (error) {
      failed.push({ candidate: item, error });
    }
  }

  return { attempted: items.length, saved, failed };
}

export function isPartialFailure(outcome: AssignmentOutcome): boolean {
  return outcome.failed.length > 0;
}

/**
 * The sentence shown after a save. A partial run names both numbers, because
 * "something went wrong" after six of eight items were assigned tells an owner
 * to retry all eight — and the six that landed are the ones they would then
 * believe had not.
 */
export function describeSaveOutcome(outcome: AssignmentOutcome): string {
  const { attempted, saved, failed } = outcome;

  if (attempted === 0) {
    return NOTHING_CHOSEN;
  }

  if (failed.length === 0) {
    return `${countOf(saved.length)} added to this heir's inheritance.`;
  }

  if (saved.length === 0) {
    return `Nothing was saved — none of the ${attempted} items could be added. Try again.`;
  }

  return `${saved.length} of ${attempted} saved. The rest were not added; try again for those.`;
}

function countOf(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

export const NOTHING_CHOSEN = 'Nothing was chosen, so nothing changed.';

export const UNCHECKED_IS_NOT_REMOVAL =
  'Ticking a box adds an item. Leaving one unticked changes nothing — to take something back, ' +
  'remove it from this heir directly.';

export const HEIR_ACCOUNT_CLOSED =
  'This heir closed their account, so nothing can be wrapped for them. Remove them and choose ' +
  'another.';

export interface InheritanceContext extends SecretsContext, NotesContext, DocumentsContext {}

export async function loadInheritanceCandidates(
  context: InheritanceContext,
): Promise<InheritanceCandidate[]> {
  const [secrets, notes, documents] = await Promise.all([
    loadSecrets(context),
    loadNotes(context),
    loadDocuments(context),
  ]);

  return buildInheritanceCandidates({ secrets, notes, documents });
}

async function loadSecrets(context: InheritanceContext): Promise<OpenedSecret[]> {
  const records = await listSecrets(context);

  return Promise.all(
    records.map(async (record) => {
      try {
        return { record, plaintext: await openSecret(context, record) };
      } catch {
        return { record };
      }
    }),
  );
}

async function loadNotes(context: InheritanceContext): Promise<OpenedNote[]> {
  const records = await listNotes(context);

  return Promise.all(
    records.map(async (record) => {
      try {
        return { record, plaintext: await openNote(context, record) };
      } catch {
        return { record };
      }
    }),
  );
}

async function loadDocuments(context: InheritanceContext): Promise<OpenedDocument[]> {
  const metas = await listDocumentsMeta(context);
  const summaries = await loadDocumentSummaries(context, metas);

  const opened: OpenedDocument[] = [];
  for (const summary of summaries) {
    try {
      opened.push({ record: await getDocument(context, summary.id), summary });
    } catch {
      continue;
    }
  }

  return opened;
}
