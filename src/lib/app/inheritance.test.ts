import { describe, expect, it } from 'vitest';
import type { DocumentRecord, DocumentSummary } from '@/lib/documents';
import type { NoteRecord } from '@/lib/notes';
import type { SecretRecord } from '@/lib/secrets';
import type { InheritanceShare } from '@/lib/succession';
import {
  buildInheritanceCandidates,
  candidateKey,
  groupByType,
  isAlreadyShared,
  itemsToAssign,
  selectableKeys,
  toInheritableItem,
  UNTITLED_SECRET,
  type InheritanceCandidate,
} from './inheritance';
import { UNREADABLE_SECRET_NAME, encodeSecretPayload } from './vault';
import { UNREADABLE_NOTE_TITLE, UNTITLED_NOTE } from './notes';
import { UNREADABLE_DOCUMENT_TITLE, UNTITLED_DOCUMENT } from './documents';

const WRAPPED = 'd3JhcHBlZC1kZWs=';

function secret(id: string, overrides: Partial<SecretRecord> = {}): SecretRecord {
  return {
    id,
    ciphertext: 'AQIDBA==',
    wrapped_dek: WRAPPED,
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
    updated_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function note(id: string, overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    ciphertext: 'AQIDBA==',
    wrapped_dek: WRAPPED,
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
    updated_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function documentRecord(id: string): DocumentRecord {
  return {
    id,
    wrapped_dek: WRAPPED,
    snapshot_ciphertext: 'AQIDBA==',
    snapshot_seq: 4,
    revision: 4,
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
    updated_at: '2026-07-26T12:00:00Z',
  };
}

function summary(id: string, overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id,
    title: 'A document',
    preview: '',
    updatedAt: '2026-07-26T12:00:00Z',
    createdAt: '2026-07-26T12:00:00Z',
    latestSeq: 4,
    snapshotSeq: 4,
    revision: 4,
    readable: true,
    ...overrides,
  };
}

function shared(...itemIds: string[]): InheritanceShare[] {
  return itemIds.map((item_id) => ({
    id: `share-${item_id}`,
    beneficiary_id: 'b',
    item_id,
    item_type: 'secret' as const,
    pq_hybrid_encrypted_item_key: 'opaque',
    version: 'v1',
    created_at: '2026-07-26T12:00:00Z',
  }));
}

function candidates(): InheritanceCandidate[] {
  return buildInheritanceCandidates({
    secrets: [
      { record: secret('s-zebra'), plaintext: encodeSecretPayload({ name: 'Zebra', value: 'v' }) },
      { record: secret('s-apple'), plaintext: encodeSecretPayload({ name: 'apple', value: 'v' }) },
    ],
    notes: [{ record: note('n-1'), plaintext: 'A letter\nbody' }],
    documents: [{ record: documentRecord('d-1'), summary: summary('d-1') }],
  });
}

describe('building the selectable list', () => {
  it('sorts by type, then title, with the merkle tree’s type order', () => {
    const list = candidates();

    expect(list.map((entry) => entry.type)).toEqual(['document', 'note', 'secret', 'secret']);
    expect(list.slice(2).map((entry) => entry.title)).toEqual(['apple', 'Zebra']);
  });

  it('sorts titles case-insensitively, so casing does not shuffle the list', () => {
    const list = buildInheritanceCandidates({
      secrets: [
        { record: secret('a'), plaintext: encodeSecretPayload({ name: 'beta', value: 'v' }) },
        { record: secret('b'), plaintext: encodeSecretPayload({ name: 'Alpha', value: 'v' }) },
      ],
      notes: [],
      documents: [],
    });

    expect(list.map((entry) => entry.title)).toEqual(['Alpha', 'beta']);
  });

  it('takes each title from where that type actually keeps it', () => {
    const list = candidates();

    expect(list[0].title).toBe('A document');
    expect(list[1].title).toBe('A letter');
    expect(list.map((entry) => entry.wrappedDek)).toEqual([WRAPPED, WRAPPED, WRAPPED, WRAPPED]);
  });

  it('names an item whose title is empty rather than rendering a blank row', () => {
    const list = buildInheritanceCandidates({
      secrets: [{ record: secret('s'), plaintext: encodeSecretPayload({ name: '  ', value: 'v' }) }],
      notes: [{ record: note('n'), plaintext: '   ' }],
      documents: [{ record: documentRecord('d'), summary: summary('d', { title: '' }) }],
    });

    expect(list.map((entry) => entry.title)).toEqual([
      UNTITLED_DOCUMENT,
      UNTITLED_NOTE,
      UNTITLED_SECRET,
    ]);
    expect(list.every((entry) => entry.assignable)).toBe(true);
  });

  it('groups by type and drops the groups that are empty', () => {
    const groups = groupByType(candidates());

    expect(groups.map((group) => group.type)).toEqual(['document', 'note', 'secret']);
    expect(groups.map((group) => group.items.length)).toEqual([1, 1, 2]);

    expect(groupByType([]).length).toBe(0);
  });
});

describe('an item this device cannot read', () => {
  it('is listed, named as unreadable, and not selectable', () => {
    const list = buildInheritanceCandidates({
      secrets: [{ record: secret('s') }],
      notes: [{ record: note('n') }],
      documents: [
        { record: documentRecord('d'), summary: summary('d', { readable: false, title: '' }) },
      ],
    });

    expect(list.map((entry) => entry.title)).toEqual([
      UNREADABLE_DOCUMENT_TITLE,
      UNREADABLE_NOTE_TITLE,
      UNREADABLE_SECRET_NAME,
    ]);
    expect(list.some((entry) => entry.assignable)).toBe(false);
    expect(selectableKeys(list)).toEqual([]);
  });

  it('is excluded from the assign list even when its key is passed in', () => {
    const list = buildInheritanceCandidates({
      secrets: [{ record: secret('s') }],
      notes: [],
      documents: [],
    });

    expect(itemsToAssign(list, [candidateKey(list[0])], [])).toEqual([]);
  });

  it('is unreadable when its payload is foreign rather than merely undecryptable', () => {
    const [entry] = buildInheritanceCandidates({
      secrets: [{ record: secret('s'), plaintext: 'not json at all' }],
      notes: [],
      documents: [],
    });

    expect(entry.title).toBe(UNREADABLE_SECRET_NAME);
    expect(entry.assignable).toBe(false);
  });
});

describe('the save is additive', () => {
  it('returns only the checked items the heir does not already hold', () => {
    const list = candidates();
    const selected = list.map(candidateKey);

    const toAssign = itemsToAssign(list, selected, shared('s-apple', 'd-1'));

    expect(toAssign.map((entry) => entry.id)).toEqual(['n-1', 's-zebra']);
  });

  it('never proposes anything for an unchecked box', () => {
    const list = candidates();

    expect(itemsToAssign(list, [], shared())).toEqual([]);
    expect(itemsToAssign(list, [], shared('s-apple'))).toEqual([]);
  });

  it('re-checking an item the heir already holds is a no-op, not a re-wrap', () => {
    const list = candidates();
    const apple = list.find((entry) => entry.id === 's-apple')!;

    expect(itemsToAssign(list, [candidateKey(apple)], shared('s-apple'))).toEqual([]);
    expect(isAlreadyShared(shared('s-apple'), apple)).toBe(true);
  });

  it('ignores a key that matches nothing in the list', () => {
    expect(itemsToAssign(candidates(), ['secret|does-not-exist'], [])).toEqual([]);
  });

  it('hands lib/succession exactly the shape it assigns', () => {
    const [document] = candidates();

    expect(toInheritableItem(document)).toEqual({
      type: 'document',
      id: 'd-1',
      wrappedDek: WRAPPED,
    });
  });
});
