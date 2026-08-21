import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@/lib/encoding';
import { leafHash, orderedLeafHashesHex, vaultRootHex, type VaultItem } from '@/lib/vaultmerkle';
import type { AnchorSummary, InheritedContent } from '@/lib/succession';
import {
  anchorableBlob,
  NotVerifiedError,
  openInherited,
  anchorForRelease,
  epochOf,
  verifyInherited,
  type ClaimFailure,
} from './claim';

const SECRET_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NOTE_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const DOC_ID = '4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7a8b';

// The owner's vault as it was anchored: three items, one of which is ours.
const vault: VaultItem[] = [
  { type: 'secret', id: SECRET_ID, blob: 'c2VjcmV0LWNpcGhlcnRleHQ=' },
  { type: 'note', id: NOTE_ID, blob: 'bm90ZS1jaXBoZXJ0ZXh0' },
  { type: 'document', id: DOC_ID, blob: 'ZG9jLXNuYXBzaG90' },
];

const leaves = orderedLeafHashesHex(vault);
const chainRoot = vaultRootHex(vault);

function content(over: Partial<InheritedContent> = {}): InheritedContent {
  return {
    item_id: SECRET_ID,
    item_type: 'secret',
    version: 'v1',
    ciphertext: 'c2VjcmV0LWNpcGhlcnRleHQ=',
    ...over,
  };
}

function verify(over: Partial<InheritedContent> = {}, root: string = chainRoot) {
  return verifyInherited({ content: content(over), leaves, chainRoot: root, epoch: 20685 });
}

describe('verifying an inherited item against the chain', () => {
  it('verifies each of the three item types', () => {
    expect(verify().verified).toBe(true);
    expect(verify({ item_id: NOTE_ID, item_type: 'note', ciphertext: 'bm90ZS1jaXBoZXJ0ZXh0' }).verified).toBe(true);
    expect(
      verify({
        item_id: DOC_ID,
        item_type: 'document',
        ciphertext: undefined,
        snapshot_ciphertext: 'ZG9jLXNuYXBzaG90',
      }).verified,
    ).toBe(true);
  });

  it('reports the leaf and the root it verified against', () => {
    const verdict = verify();

    expect(verdict).toMatchObject({ verified: true, root: chainRoot, epoch: 20685 });
    expect(verdict.leaf).toBe(`0x${bytesToHex(leafHash(vault[0]))}`);
  });

  it('fails when one byte of the ciphertext is altered', () => {
    const tampered = verify({ ciphertext: 'c2VjcmV0LWNpcGhlcnRleHQ+' });

    expect(tampered).toMatchObject({
      verified: false,
      reason: 'item-not-in-the-anchored-set' satisfies ClaimFailure,
    });
  });

  it('fails when the leaf set does not rebuild the on-chain root', () => {
    expect(verify({}, `0x${'11'.repeat(32)}`)).toMatchObject({
      verified: false,
      reason: 'leaf-set-does-not-rebuild-the-chain-root' satisfies ClaimFailure,
    });
  });

  it('will not accept a leaf set that contains the item but rebuilds to nothing on-chain', () => {
    // The dangerous shape: Cryple hands over a set with your leaf in it, but the
    // chain never saw that set. Membership alone must not be enough.
    const forged = verifyInherited({
      content: content(),
      leaves,
      chainRoot: `0x${'ab'.repeat(32)}`,
      epoch: 20685,
    });

    expect(forged.verified).toBe(false);
  });

  it('will not accept a matching root over a set this item is not in', () => {
    const others = vault.slice(1);

    expect(
      verifyInherited({
        content: content(),
        leaves: orderedLeafHashesHex(others),
        chainRoot: vaultRootHex(others),
        epoch: 20685,
      }),
    ).toMatchObject({ verified: false, reason: 'item-not-in-the-anchored-set' });
  });

  it('says so when the chain holds no root, rather than passing', () => {
    // Called directly: `verify`'s default parameter would swallow an explicit
    // undefined and hand back the real root, quietly testing nothing.
    expect(
      verifyInherited({ content: content(), leaves, chainRoot: undefined, epoch: 20685 }),
    ).toMatchObject({ verified: false, reason: 'no-chain-root' });
  });

  it('says so when nothing was anchored', () => {
    expect(
      verifyInherited({ content: content(), leaves: [], chainRoot, epoch: 20685 }),
    ).toMatchObject({ verified: false, reason: 'no-anchor' });
  });

  it('accepts the hashes in either case and with or without 0x', () => {
    const shouted = leaves.map((hex) => hex.slice(2).toUpperCase());

    expect(
      verifyInherited({ content: content(), leaves: shouted, chainRoot, epoch: 20685 }),
    ).toMatchObject({ verified: true });
  });
});

describe('which bytes the leaf commits to', () => {
  it('hashes a document snapshot, never its ciphertext field', () => {
    expect(
      anchorableBlob({
        item_id: DOC_ID,
        item_type: 'document',
        version: 'v1',
        snapshot_ciphertext: 'ZG9jLXNuYXBzaG90',
      }),
    ).toBe('ZG9jLXNuYXBzaG90');
  });

  it('has nothing to hash for a document that was never saved', () => {
    expect(
      verify({
        item_id: DOC_ID,
        item_type: 'document',
        ciphertext: undefined,
        snapshot_ciphertext: '',
      }),
    ).toMatchObject({ verified: false, reason: 'nothing-to-hash' });
  });
});

describe('choosing the epoch to verify against', () => {
  const anchors = (...epochs: number[]): AnchorSummary[] =>
    epochs.map((epoch) => ({ epoch, root: '0x', leaf_count: 3, created_at: 'A' }));

  it('takes the newest anchor at or before the release, not the latest', () => {
    const releasedAt = 20685 * 86_400;

    expect(anchorForRelease(anchors(20686, 20684, 20680), releasedAt)?.epoch).toBe(20684);
  });

  it('includes an anchor made on the day of the release', () => {
    const releasedAt = 20685 * 86_400 + 3600;

    expect(anchorForRelease(anchors(20686, 20685), releasedAt)?.epoch).toBe(20685);
  });

  it('has nothing to offer when every anchor postdates the release', () => {
    expect(anchorForRelease(anchors(20690), 20685 * 86_400)).toBeUndefined();
  });

  it('falls back to the newest when the release moment is unknown', () => {
    expect(anchorForRelease(anchors(20680, 20686), undefined)?.epoch).toBe(20686);
  });

  it('converts unix seconds to the epoch the contract counts in', () => {
    expect(epochOf(20685 * 86_400)).toBe(20685);
    expect(epochOf(20685 * 86_400 + 86_399)).toBe(20685);
  });
});

describe('decrypting only after verification', () => {
  const decryptors = {
    unwrapItemKey: async () => new Uint8Array(32).fill(7),
    openText: async () => 'the plaintext',
    openDocument: async () => ({ text: 'the document', appliedDeltas: 0 }),
  };

  it('opens a verified item', async () => {
    const opened = await openInherited(content(), 'wrapped', verify(), decryptors);

    expect(opened).toEqual({ text: 'the plaintext', unverifiedEdits: 0 });
  });

  it('refuses an item that failed, rather than showing it behind a warning', async () => {
    const failed = verify({ ciphertext: 'c2VjcmV0LWNpcGhlcnRleHQ+' });

    await expect(openInherited(content(), 'wrapped', failed, decryptors)).rejects.toThrow(
      NotVerifiedError,
    );
  });

  it('never unwraps the key for an unverified item', async () => {
    let unwraps = 0;

    await expect(
      openInherited(content(), 'wrapped', verify({}, `0x${'11'.repeat(32)}`), {
        ...decryptors,
        unwrapItemKey: async () => {
          unwraps += 1;

          return new Uint8Array(32);
        },
      }),
    ).rejects.toThrow(NotVerifiedError);

    expect(unwraps).toBe(0);
  });

  it('counts the post-snapshot deltas it merged, since none of them are proven', async () => {
    const doc = content({
      item_id: DOC_ID,
      item_type: 'document',
      ciphertext: undefined,
      snapshot_ciphertext: 'ZG9jLXNuYXBzaG90',
    });

    const opened = await openInherited(doc, 'wrapped', verify(doc), {
      ...decryptors,
      openDocument: async () => ({ text: 'the document', appliedDeltas: 3 }),
    });

    expect(opened.unverifiedEdits).toBe(3);
  });

  it('reports a compacted document as fully proven, not merely as a document', async () => {
    const doc = content({
      item_id: DOC_ID,
      item_type: 'document',
      ciphertext: undefined,
      snapshot_ciphertext: 'ZG9jLXNuYXBzaG90',
    });

    const opened = await openInherited(doc, 'wrapped', verify(doc), decryptors);

    expect(opened.unverifiedEdits).toBe(0);
  });

  it('zeroes the item key it unwrapped', async () => {
    const dek = new Uint8Array(32).fill(7);

    await openInherited(content(), 'wrapped', verify(), {
      ...decryptors,
      unwrapItemKey: async () => dek,
    });

    expect([...dek]).toEqual(Array(32).fill(0));
  });
});
