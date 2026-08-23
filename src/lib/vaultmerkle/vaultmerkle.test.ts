import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToHex, hexToBytes } from '@/lib/encoding';
import {
  canonicalOrder,
  DuplicateItemError,
  EmptyBlobError,
  EmptyTreeError,
  ItemNotInTreeError,
  largestPowerOfTwoBelow,
  leafHash,
  leafPreimage,
  prove,
  UnknownItemTypeError,
  vaultRoot,
  verifyProof,
  type ItemType,
  type VaultItem,
} from './index';

const fixture = vectors.vault_merkle;

const items: VaultItem[] = fixture.items_in_canonical_order.map((entry) => ({
  type: entry.item_type as ItemType,
  id: entry.item_id,
  blob: entry.blob_as_served,
}));

describe('the leaf, against the cross-client vectors', () => {
  it.each(fixture.items_in_canonical_order)(
    'reproduces the $item_type preimage and leaf',
    (entry) => {
      const item: VaultItem = {
        type: entry.item_type as ItemType,
        id: entry.item_id,
        blob: entry.blob_as_served,
      };
      expect(leafPreimage(item)).toBe(entry.leaf_preimage);
      expect(bytesToHex(leafHash(item))).toBe(entry.leaf_hex);
    },
  );

  it('hashes the base64 text as served, never the decoded bytes', () => {
    const entry = fixture.items_in_canonical_order[0];
    expect(leafPreimage({
      type: entry.item_type as ItemType,
      id: entry.item_id,
      blob: entry.blob_as_served,
    })).toContain(entry.content_sha256_hex);
  });

  it('binds the type, so a note cannot pass as a secret with identical bytes', () => {
    const blob = 'aWRlbnRpY2FsLWNpcGhlcnRleHQ=';
    const id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    expect(bytesToHex(leafHash({ type: 'note', id, blob }))).not.toBe(
      bytesToHex(leafHash({ type: 'secret', id, blob })),
    );
  });
});

describe('the tree, against the cross-client vectors', () => {
  it('reproduces the anchored root', () => {
    expect(bytesToHex(vaultRoot(items))).toBe(fixture.root_hex);
  });

  it('does not depend on the order the listings returned', () => {
    const shuffled = [items[2], items[0], items[1]];
    expect(bytesToHex(vaultRoot(shuffled))).toBe(fixture.root_hex);
  });

  it('sorts document before note before secret', () => {
    expect(canonicalOrder([items[2], items[1], items[0]]).map((item) => item.type)).toEqual([
      'document',
      'note',
      'secret',
    ]);
  });

  it('uses the RFC 6962 split rather than duplicating the last node', () => {
    expect([2, 3, 4, 5, 8, 9].map(largestPowerOfTwoBelow)).toEqual([1, 2, 2, 4, 4, 8]);
  });

  it('is a single leaf when the vault holds one item', () => {
    expect(bytesToHex(vaultRoot([items[0]]))).toBe(fixture.items_in_canonical_order[0].leaf_hex);
  });
});

describe('the inclusion proof, against the cross-client vectors', () => {
  const [type, id] = fixture.inclusion_proof_for.split(' ') as [ItemType, string];

  it('reproduces the audit path and the side of each sibling', () => {
    const proof = prove(items, type, id);
    expect(proof.steps.map((step) => bytesToHex(step.hash))).toEqual(fixture.inclusion_proof_path);
    expect(proof.steps.map((step) => (step.siblingIsRight ? 'right' : 'left'))).toEqual(
      fixture.inclusion_proof_sibling_side,
    );
  });

  it('folds back to the anchored root', () => {
    expect(verifyProof(prove(items, type, id), hexToBytes(fixture.root_hex))).toBe(true);
  });

  it('fails against any other root', () => {
    expect(verifyProof(prove(items, type, id), hexToBytes('11'.repeat(32)))).toBe(false);
  });

  it('refuses to prove an item the tree does not hold', () => {
    expect(() => prove(items, 'secret', 'ffffffff-ffff-4fff-8fff-ffffffffffff')).toThrow(
      ItemNotInTreeError,
    );
  });
});

describe('deliberate refusals rather than silent skips', () => {
  it('refuses an empty blob instead of minting a leaf over nothing', () => {
    expect(() => leafHash({ type: 'document', id: items[0].id, blob: '' })).toThrow(EmptyBlobError);
  });

  it('refuses an unknown item type', () => {
    expect(() => leafHash({ type: 'file' as ItemType, id: items[0].id, blob: 'x' })).toThrow(
      UnknownItemTypeError,
    );
  });

  it('refuses an empty vault, which has no root at all', () => {
    expect(() => vaultRoot([])).toThrow(EmptyTreeError);
  });

  it('refuses a repeated type and id', () => {
    expect(() => vaultRoot([items[0], items[0]])).toThrow(DuplicateItemError);
  });
});
