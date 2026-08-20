import { getDocument, listDocumentsMeta, loadDocumentSummaries } from '@/lib/documents';
import type { DocumentRecord, DocumentSummary, DocumentsContext } from '@/lib/documents';
import { listNotes, openNote, type NotesContext } from '@/lib/notes';
import { listSecrets, openSecret, type SecretsContext } from '@/lib/secrets';
import { ITEM_TYPES, type InheritableItem, type InheritanceShare, type ItemType } from '@/lib/succession';
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
