import { describe, expect, it } from 'vitest';
import type { DocumentMetaRecord, DocumentRecord } from '@/lib/documents';
import type { NoteMetaRecord } from '@/lib/notes';
import type { VaultItem } from '@/lib/vaultmerkle';
import {
  cachedNoteItems,
  documentCacheKey,
  documentItem,
  documentStateMessage,
  documentsNeedingCompaction,
  documentsWithoutLeaf,
  isVerifiable,
  NEVER_PROTECTED,
  noteCacheKey,
  notesNeedingFetch,
  NOT_YET_PROTECTED,
  pruneCache,
} from './anchoring';

function docMeta(over: Partial<DocumentMetaRecord>): DocumentMetaRecord {
  return {
    id: '4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7a8b',
    snapshot_seq: 4,
    latest_seq: 4,
    revision: 2,
    version: 'v1',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    ...over,
  };
}

describe('a document only counts once it is settled', () => {
  it('is verifiable when the snapshot is current', () => {
    expect(isVerifiable(docMeta({}))).toBe(true);
    expect(documentStateMessage(docMeta({}))).toBeUndefined();
  });

  it('is not verifiable while deltas outrun the snapshot', () => {
    const pending = docMeta({ snapshot_seq: 4, latest_seq: 9 });
    expect(isVerifiable(pending)).toBe(false);
    expect(documentStateMessage(pending)).toBe(NOT_YET_PROTECTED);
    expect(documentsNeedingCompaction([pending])).toHaveLength(1);
  });

  it('has no leaf at all when it was never compacted', () => {
    const fresh = docMeta({ snapshot_seq: 0, latest_seq: 0 });
    expect(isVerifiable(fresh)).toBe(false);
    expect(documentStateMessage(fresh)).toBe(NEVER_PROTECTED);
    expect(documentsWithoutLeaf([fresh])).toHaveLength(1);
  });

  it('refuses to mint a leaf over an empty snapshot', () => {
    const record = { id: 'x', snapshot_ciphertext: '' } as DocumentRecord;
    expect(documentItem(record)).toBeUndefined();
  });
});

describe('leaf cache keys move exactly when the content can', () => {
  it('keys a note on its updated_at', () => {
    expect(noteCacheKey({ id: 'n1', updated_at: 'A' })).not.toBe(
      noteCacheKey({ id: 'n1', updated_at: 'B' }),
    );
  });

  it('keys a document on its revision, which increments on compaction', () => {
    expect(documentCacheKey({ id: 'd1', revision: 2 })).not.toBe(
      documentCacheKey({ id: 'd1', revision: 3 })
    );
  });

  it('fetches only the notes whose cached leaf is stale', () => {
    const meta = [
      { id: 'n1', updated_at: 'A' },
      { id: 'n2', updated_at: 'B' },
    ] as NoteMetaRecord[];
    const cached = new Map<string, VaultItem>([
      [noteCacheKey(meta[0]), { type: 'note', id: 'n1', blob: 'x' }],
    ]);

    expect(notesNeedingFetch(meta, cached).map((n) => n.id)).toEqual(['n2']);
    expect(cachedNoteItems(meta, cached).map((i) => i.id)).toEqual(['n1']);
  });

  it('a cold device after restore must fetch every note', () => {
    const meta = [
      { id: 'n1', updated_at: 'A' },
      { id: 'n2', updated_at: 'B' },
    ] as NoteMetaRecord[];
    expect(notesNeedingFetch(meta, new Map())).toHaveLength(2);
  });

  it('drops cache entries for items no longer in the vault', () => {
    const cached = new Map<string, VaultItem>([
      ['note|n1|A', { type: 'note', id: 'n1', blob: 'x' }],
      ['note|gone|A', { type: 'note', id: 'gone', blob: 'y' }],
    ]);
    expect([...pruneCache(cached, ['note|n1|A']).keys()]).toEqual(['note|n1|A']);
  });
});

import { collectVault, NothingToAnchorError, type VaultSources } from './anchoring';
import { vaultRootHex } from '@/lib/vaultmerkle';

function sources(over: Partial<VaultSources> = {}): VaultSources {
  return {
    listSecrets: async () => [],
    listNotesMeta: async () => [],
    getNote: async () => {
      throw new Error('unexpected note fetch');
    },
    listDocumentsMeta: async () => [],
    getDocument: async () => {
      throw new Error('unexpected document fetch');
    },
    ...over,
  };
}

describe('collecting the vault', () => {
  it('refuses to anchor an empty vault rather than anchoring nothing', async () => {
    await expect(collectVault(sources())).rejects.toThrow(NothingToAnchorError);
  });

  it('excludes a never-compacted document without fetching it', async () => {
    const collected = await collectVault(
      sources({
        listSecrets: async () => [{ id: 's1', ciphertext: 'YQ==', updated_at: 'A' } as never],
        listDocumentsMeta: async () => [docMeta({ id: 'd1', snapshot_seq: 0, latest_seq: 0 })],
      }),
    );
    expect(collected.excludedDocuments).toEqual(['d1']);
    expect(collected.items.map((i) => i.type)).toEqual(['secret']);
  });

  it('still anchors a document with pending deltas, but reports it', async () => {
    const collected = await collectVault(
      sources({
        listDocumentsMeta: async () => [docMeta({ id: 'd1', snapshot_seq: 4, latest_seq: 9 })],
        getDocument: async () => ({ id: 'd1', snapshot_ciphertext: 'ZA==' }) as never,
      }),
    );
    expect(collected.pendingDocuments).toEqual(['d1']);
    expect(collected.items).toHaveLength(1);
  });

  it('reuses a cached note leaf instead of re-fetching it', async () => {
    let fetches = 0;
    const meta = [{ id: 'n1', updated_at: 'A' }] as NoteMetaRecord[];
    const cache = new Map([[noteCacheKey(meta[0]), { type: 'note', id: 'n1', blob: 'bg==' } as const]]);

    const collected = await collectVault(
      sources({
        listNotesMeta: async () => meta,
        getNote: async () => {
          fetches += 1;
          return { id: 'n1', ciphertext: 'bg==' } as never;
        },
      }),
      { cache },
    );

    expect(fetches).toBe(0);
    expect(collected.items).toHaveLength(1);
  });

  it('re-fetches a note whose updated_at moved', async () => {
    let fetches = 0;
    const cache = new Map([['note|n1|OLD', { type: 'note', id: 'n1', blob: 'b2xk' } as const]]);

    await collectVault(
      sources({
        listNotesMeta: async () => [{ id: 'n1', updated_at: 'NEW' }] as NoteMetaRecord[],
        getNote: async () => {
          fetches += 1;
          return { id: 'n1', ciphertext: 'bmV3' } as never;
        },
      }),
      { cache },
    );

    expect(fetches).toBe(1);
  });

  it('produces a root that does not depend on listing order', async () => {
    const build = (secretsFirst: boolean) =>
      collectVault(
        sources({
          listSecrets: async () => [
            { id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', ciphertext: 'c2VjcmV0LWEtY2lwaGVydGV4dA==', updated_at: 'A' },
            { id: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', ciphertext: 'c2VjcmV0LWItY2lwaGVydGV4dA==', updated_at: 'A' },
          ].slice().sort(() => (secretsFirst ? 1 : -1)) as never,
        }),
      );

    const [a, b] = await Promise.all([build(true), build(false)]);
    expect(vaultRootHex(a.items)).toBe(vaultRootHex(b.items));
  });
});

import { runAnchorPass, vaultAnchorState } from './anchoring';

describe('the anchor pass compacts before it measures', () => {
  it('compacts every document whose deltas outrun its snapshot', async () => {
    const compacted: string[] = [];
    let listed = 0;

    const pass = await runAnchorPass(
      sources({
        listDocumentsMeta: async () => {
          listed += 1;
          return listed === 1
            ? [docMeta({ id: 'd1', snapshot_seq: 4, latest_seq: 9 })]
            : [docMeta({ id: 'd1', snapshot_seq: 9, latest_seq: 9 })];
        },
        getDocument: async () => ({ id: 'd1', snapshot_ciphertext: 'ZA==' }) as never,
      }),
      { compactDocument: async (id) => void compacted.push(id) },
    );

    expect(compacted).toEqual(['d1']);
    expect(pass.pendingDocuments).toEqual([]);
    expect(pass.root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('leaves the document reported as pending when compaction is not offered', async () => {
    const pass = await runAnchorPass(
      sources({
        listDocumentsMeta: async () => [docMeta({ id: 'd1', snapshot_seq: 4, latest_seq: 9 })],
        getDocument: async () => ({ id: 'd1', snapshot_ciphertext: 'ZA==' }) as never,
      }),
    );
    expect(pass.compacted).toEqual([]);
    expect(pass.pendingDocuments).toEqual(['d1']);
  });
});

describe('detecting an anchor that never confirmed', () => {
  const root = '0x38824a82f4d55e8056f862ed1e2aaa7fb60d1c2793fedab1fec873b14c94ca87';

  it('is anchored when the chain holds this root for this epoch', () => {
    expect(vaultAnchorState(root, { epoch: 20685, root }, 20685)).toMatchObject({
      state: 'anchored',
    });
  });

  it('is stale when the browser closed before the anchor landed', () => {
    expect(vaultAnchorState(root, { epoch: 20685, root: `0x${'11'.repeat(32)}` }, 20685)).toMatchObject(
      { state: 'stale' },
    );
  });

  it('is stale when the vault changed since yesterday', () => {
    expect(vaultAnchorState(root, { epoch: 20684, root }, 20685)).toMatchObject({ state: 'stale' });
  });

  it('is never when nothing was ever anchored', () => {
    expect(vaultAnchorState(root, undefined, 20685)).toMatchObject({ state: 'never' });
  });
});

import { buildProtectionView, PROTECTION_HEADLINE_OK } from './anchoring';

describe('what the owner is told about protection', () => {
  const root = '0x38824a82f4d55e8056f862ed1e2aaa7fb60d1c2793fedab1fec873b14c94ca87';

  it('confirms protection only when the chain agrees', () => {
    const view = buildProtectionView({ state: 'anchored', epoch: 20685, root });
    expect(view.headline).toBe(PROTECTION_HEADLINE_OK);
    expect(view.needsAnchor).toBe(false);
    expect(view.tone).toBe('ok');
  });

  it('never claims full protection while a document has uncovered changes', () => {
    const view = buildProtectionView({ state: 'anchored', epoch: 20685, root }, ['d1']);
    expect(view.needsAnchor).toBe(false);
    expect(view.tone).toBe('attention');
    expect(view.detail).toContain('not covered yet');
  });

  it('asks for an anchor when the browser closed before the last one landed', () => {
    expect(buildProtectionView({ state: 'stale', currentRoot: root }).needsAnchor).toBe(true);
  });

  it('asks for a first anchor when nothing was ever protected', () => {
    const view = buildProtectionView({ state: 'never', currentRoot: root });
    expect(view.needsAnchor).toBe(true);
    expect(view.actionLabel).toBe('Protect my vault');
  });

  it('speaks no chain vocabulary', () => {
    const jargon = /merkle|root|anchor|epoch|chain|hash|gas|on-chain/i;
    for (const view of [
      buildProtectionView({ state: 'anchored', epoch: 1, root }),
      buildProtectionView({ state: 'stale', currentRoot: root }, ['d1'], ['d2']),
      buildProtectionView({ state: 'never', currentRoot: root }),
    ]) {
      expect(view.headline).not.toMatch(jargon);
      expect(view.detail ?? '').not.toMatch(jargon);
    }
  });
});

import { allVerified, verifyVaultAgainstRoot } from './anchoring';
import vectors from '@/test/fixtures/test-vectors.json';

describe('verifying every item against the root the chain returned', () => {
  const items = vectors.vault_merkle.items_in_canonical_order.map((entry) => ({
    type: entry.item_type as 'secret' | 'note' | 'document',
    id: entry.item_id,
    blob: entry.blob_as_served,
  }));
  const chainRoot = `0x${vectors.vault_merkle.root_hex}`;

  it('verifies one item of each type against the anchored root', () => {
    const results = verifyVaultAgainstRoot(items, chainRoot);
    expect(results.map((r) => r.type).sort()).toEqual(['document', 'note', 'secret']);
    expect(allVerified(results)).toBe(true);
  });

  it('fails every item when the chain holds a different root', () => {
    const results = verifyVaultAgainstRoot(items, `0x${'11'.repeat(32)}`);
    expect(results.every((r) => !r.verified)).toBe(true);
    expect(allVerified(results)).toBe(false);
  });

  it('fails when one byte of one blob changed', () => {
    const tampered = [{ ...items[1], blob: `${items[1].blob.slice(0, -2)}XX` }, items[0], items[2]];
    expect(allVerified(verifyVaultAgainstRoot(tampered, chainRoot))).toBe(false);
  });
});
