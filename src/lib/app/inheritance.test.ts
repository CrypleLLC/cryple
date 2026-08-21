import { describe, expect, it } from 'vitest';
import type { DocumentRecord, DocumentSummary } from '@/lib/documents';
import type { NoteRecord } from '@/lib/notes';
import type { SecretRecord } from '@/lib/secrets';
import type { InheritanceShare } from '@/lib/succession';
import type { Beneficiary } from '@/lib/succession';
import {
  assignSelection,
  buildAssignedItems,
  buildHeirTabs,
  buildInheritanceCandidates,
  candidateKey,
  groupByType,
  isAlreadyShared,
  describeSaveOutcome,
  isPartialFailure,
  itemsToAssign,
  MISSING_ITEM_TITLE,
  nextActiveTab,
  removeHeirConfirmation,
  NOTHING_CHOSEN,
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

describe('saving the chosen items', () => {
  const three = () => candidates().slice(0, 3);

  it('assigns each one and reports them all saved', async () => {
    const seen: string[] = [];

    const outcome = await assignSelection(three(), async (item) => {
      seen.push(item.id);
    });

    expect(seen).toEqual(three().map((item) => item.id));
    expect(outcome.saved).toHaveLength(3);
    expect(outcome.failed).toEqual([]);
    expect(isPartialFailure(outcome)).toBe(false);
    expect(describeSaveOutcome(outcome)).toBe("3 items added to this heir's inheritance.");
  });

  it('keeps going after a failure rather than abandoning the rest', async () => {
    const items = three();

    const outcome = await assignSelection(items, async (item) => {
      if (item.id === items[0].id) {
        throw new Error('network');
      }
    });

    expect(outcome.saved.map((item) => item.id)).toEqual([items[1].id, items[2].id]);
    expect(outcome.failed.map((entry) => entry.candidate.id)).toEqual([items[0].id]);
    expect(isPartialFailure(outcome)).toBe(true);
  });

  it('names both numbers on a partial save, not just that something failed', async () => {
    const items = three();

    const outcome = await assignSelection(items, async (item) => {
      if (item.id === items[2].id) {
        throw new Error('network');
      }
    });

    expect(describeSaveOutcome(outcome)).toBe(
      '2 of 3 saved. The rest were not added; try again for those.',
    );
  });

  it('says nothing was saved when every request failed', async () => {
    const outcome = await assignSelection(three(), async () => {
      throw new Error('network');
    });

    expect(outcome.saved).toEqual([]);
    expect(describeSaveOutcome(outcome)).toContain('Nothing was saved');
  });

  it('writes nothing when nothing was chosen', async () => {
    let calls = 0;

    const outcome = await assignSelection([], async () => {
      calls += 1;
    });

    expect(calls).toBe(0);
    expect(outcome.attempted).toBe(0);
    expect(describeSaveOutcome(outcome)).toBe(NOTHING_CHOSEN);
  });

  it('counts one item in the singular', async () => {
    const outcome = await assignSelection(three().slice(0, 1), async () => {});

    expect(describeSaveOutcome(outcome)).toBe("1 item added to this heir's inheritance.");
  });
});

function heir(id: string, overrides: Partial<Beneficiary> = {}): Beneficiary {
  return {
    id,
    user_uuid: `uuid-${id}`,
    username: `heir-${id}`,
    user_address: 'a'.repeat(64),
    encrypted_label: 'AQIDBA==',
    public_key_x25519_snapshot: 'x',
    public_key_mlkem_snapshot: 'm',
    status: 'active',
    keys_rotated: false,
    share_count: 2,
    created_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

describe('what one heir is shown to inherit', () => {
  it('takes each title from the vault, because a share carries none', () => {
    const list = candidates();
    const shares = [
      { ...shared('s-zebra')[0], item_type: 'secret' as const },
      { ...shared('d-1')[0], item_type: 'document' as const },
    ];

    const rows = buildAssignedItems(shares, list);

    expect(rows.map((row) => [row.typeName, row.title])).toEqual([
      ['Document', 'A document'],
      ['Secret', 'Zebra'],
    ]);
    expect(rows.every((row) => row.present)).toBe(true);
    expect(rows[0].updatedAt).toBe('2026-07-26T12:00:00Z');
  });

  it('shows a share whose item is missing rather than quietly dropping it', () => {
    const rows = buildAssignedItems(shared('gone'), candidates());

    expect(rows).toHaveLength(1);
    expect(rows[0].present).toBe(false);
    expect(rows[0].title).toBe(MISSING_ITEM_TITLE);
    expect(rows[0].updatedAt).toBeUndefined();
  });

  it('orders rows the same way the picker does', () => {
    const rows = buildAssignedItems(
      [
        { ...shared('s-zebra')[0], item_type: 'secret' as const },
        { ...shared('s-apple')[0], item_type: 'secret' as const },
        { ...shared('n-1')[0], item_type: 'note' as const },
      ],
      candidates(),
    );

    expect(rows.map((row) => row.type)).toEqual(['note', 'secret', 'secret']);
    expect(rows.slice(1).map((row) => row.title)).toEqual(['apple', 'Zebra']);
  });

  it('keeps the share id, because removing one needs it and the item id will not do', () => {
    const rows = buildAssignedItems(shared('s-apple'), candidates());

    expect(rows[0].shareId).toBe('share-s-apple');
    expect(rows[0].itemId).toBe('s-apple');
  });
});

describe('the heir tab strip', () => {
  it('labels a tab with the username and carries the count', () => {
    const tabs = buildHeirTabs([heir('a'), heir('b', { share_count: 0 })]);

    expect(tabs.map((tab) => [tab.label, tab.itemCount])).toEqual([
      ['heir-a', 2],
      ['heir-b', 0],
    ]);
  });

  it('names a closed account rather than showing a username that no longer resolves', () => {
    const [tab] = buildHeirTabs([heir('a', { keys_rotated: true })]);

    expect(tab.label).toBe('(account closed)');
    expect(tab.accountClosed).toBe(true);
  });

  it('keeps the open tab across a re-read, so a refresh does not move the owner', () => {
    const tabs = buildHeirTabs([heir('a'), heir('b')]);

    expect(nextActiveTab(tabs, 'b')).toBe('b');
  });

  it('falls back to the first tab when the open one is gone', () => {
    const tabs = buildHeirTabs([heir('a')]);

    expect(nextActiveTab(tabs, 'b')).toBe('a');
  });

  it('has no active tab when there are no heirs', () => {
    expect(nextActiveTab([], 'b')).toBeUndefined();
    expect(nextActiveTab([])).toBeUndefined();
  });

  it('opens the first tab when none was chosen yet', () => {
    expect(nextActiveTab(buildHeirTabs([heir('a'), heir('b')]))).toBe('a');
  });
});

describe('confirming the removal of an heir', () => {
  it('names what goes with them, because the cascade is invisible', () => {
    expect(removeHeirConfirmation('carol', 3)).toBe(
      'Remove carol as an heir? The 3 items they inherit go with them, and re-assigning means ' +
        'wrapping each one again. Your vault itself is untouched.',
    );
  });

  it('counts one item in the singular', () => {
    expect(removeHeirConfirmation('carol', 1)).toContain('The 1 item they inherit');
  });

  it('says plainly that nothing is lost when they inherit nothing', () => {
    expect(removeHeirConfirmation('carol', 0)).toContain('They inherit nothing yet');
  });

  it('always says the vault survives, which is the fear the wording exists to answer', () => {
    for (const count of [0, 1, 5]) {
      expect(removeHeirConfirmation('carol', count)).toContain('Your vault itself is untouched');
    }
  });
});
