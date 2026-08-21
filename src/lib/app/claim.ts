import { bytesToHex, hexToBytes } from '@/lib/encoding';
import { leafHash, rootFromLeaves, type ItemType, type VaultItem } from '@/lib/vaultmerkle';
import type { AnchorSummary, InheritedContent } from '@/lib/succession';

export const SECONDS_PER_EPOCH = 86_400;

export function epochOf(unixSeconds: number): number {
  return Math.floor(unixSeconds / SECONDS_PER_EPOCH);
}

/**
 * The epoch an heir verifies against: the newest anchor **at or before** the
 * release.
 *
 * Not the latest one. A past epoch is frozen on-chain, so that root describes
 * the vault as it stood while the owner was alive — anything anchored after the
 * release is either irrelevant or something an heir has no reason to trust.
 */
export function anchorForRelease(
  anchors: readonly AnchorSummary[],
  releasedAt: number | undefined,
): AnchorSummary | undefined {
  const sorted = [...anchors].sort((a, b) => b.epoch - a.epoch);

  if (releasedAt === undefined) {
    return sorted[0];
  }

  const ceiling = epochOf(releasedAt);

  return sorted.find((anchor) => anchor.epoch <= ceiling);
}

/**
 * The bytes the leaf commits to.
 *
 * A secret or a note is its `ciphertext`; a document is its
 * `snapshot_ciphertext` and **not** its deltas. Conflating the two hashes the
 * wrong bytes and fails verification for a document that is perfectly intact.
 */
export function anchorableBlob(content: InheritedContent): string | undefined {
  const blob = content.item_type === 'document' ? content.snapshot_ciphertext : content.ciphertext;

  return blob === undefined || blob.length === 0 ? undefined : blob;
}

export function inheritedItem(content: InheritedContent): VaultItem | undefined {
  const blob = anchorableBlob(content);

  return blob === undefined
    ? undefined
    : { type: content.item_type as ItemType, id: content.item_id, blob };
}

export type ClaimVerdict =
  | { verified: true; leaf: string; root: string; epoch: number }
  | { verified: false; reason: ClaimFailure; leaf?: string };

export type ClaimFailure =
  | 'no-anchor'
  | 'no-chain-root'
  | 'leaf-set-does-not-rebuild-the-chain-root'
  | 'item-not-in-the-anchored-set'
  | 'nothing-to-hash';

export const CLAIM_FAILURE_COPY: Record<ClaimFailure, string> = {
  'no-anchor': 'Nothing was anchored on or before the release, so there is nothing to check against.',
  'no-chain-root': 'The chain holds no root for that day. Nothing here can be verified.',
  'leaf-set-does-not-rebuild-the-chain-root':
    'The record Cryple holds does not match what is on the blockchain. Do not trust this content.',
  'item-not-in-the-anchored-set':
    'This item is not in what was anchored. Its contents may have been altered.',
  'nothing-to-hash': 'This item has no saved content to verify.',
};

export interface VerificationInputs {
  content: InheritedContent;
  /** The retained leaf set, in tree order, `0x`-prefixed hex. */
  leaves: readonly string[];
  /** The root read from ProofRegistry — **on-chain**, never from our API. */
  chainRoot: string | undefined;
  epoch: number;
}

/**
 * Verifies one inherited item against the chain.
 *
 * Two independent checks, and both must hold. Rebuilding the root from the
 * retained leaf set and comparing it to the chain proves the *set* is the one
 * that was anchored; finding this item's own leaf inside it proves the *item*
 * is in that set. Either alone is worthless — a matching root over a set that
 * does not contain you says nothing about you, and a set containing you that
 * rebuilds to nothing on-chain is just a list Cryple made up.
 *
 * Nothing here consults a flag from the API, because no such flag exists and
 * the server is exactly what this is meant to be independent of.
 */
export function verifyInherited(inputs: VerificationInputs): ClaimVerdict {
  const item = inheritedItem(inputs.content);
  if (item === undefined) {
    return { verified: false, reason: 'nothing-to-hash' };
  }

  const leaf = `0x${bytesToHex(leafHash(item))}`;

  if (inputs.leaves.length === 0) {
    return { verified: false, reason: 'no-anchor', leaf };
  }

  if (inputs.chainRoot === undefined) {
    return { verified: false, reason: 'no-chain-root', leaf };
  }

  const rebuilt = `0x${bytesToHex(rootFromLeaves(inputs.leaves.map((hex) => hexToBytes(strip(hex)))))}`;

  if (!equalHex(rebuilt, inputs.chainRoot)) {
    return { verified: false, reason: 'leaf-set-does-not-rebuild-the-chain-root', leaf };
  }

  if (!inputs.leaves.some((candidate) => equalHex(candidate, leaf))) {
    return { verified: false, reason: 'item-not-in-the-anchored-set', leaf };
  }

  return { verified: true, leaf, root: inputs.chainRoot, epoch: inputs.epoch };
}

function strip(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

function equalHex(a: string, b: string): boolean {
  return strip(a).toLowerCase() === strip(b).toLowerCase();
}

export function unverifiedEditsNotice(count: number): string {
  const edits = count === 1 ? '1 edit' : `${count} edits`;

  return `${edits} made after the owner's last save are included here but carry no proof — only the saved version was anchored.`;
}

export const NO_INHERITANCES =
  'Nothing has been left to you, or nothing has been released yet. There is nothing to see here ' +
  'either way.';

export interface OpenedInheritance {
  /** A secret's JSON envelope, a note's text, or a document's plaintext. */
  text: string;
  /**
   * How many post-snapshot deltas were merged in. Every one of them is outside
   * what the anchored leaf covers, so a non-zero count is content the heir has
   * but cannot prove.
   */
  unverifiedEdits: number;
}

/** The merged result of a document's snapshot and its delta log. */
export interface MergedDocument {
  text: string;
  appliedDeltas: number;
}

export interface ClaimDecryptors {
  unwrapItemKey(wrappedKey: string): Promise<Uint8Array>;
  openText(blob: string, dek: Uint8Array): Promise<string>;
  /**
   * Documents only: the verified snapshot plus every delta after it, merged
   * through the CRDT. The snapshot alone would be the document as it stood at
   * the owner's last save, which is stale rather than safe.
   */
  openDocument(content: InheritedContent, dek: Uint8Array): Promise<MergedDocument>;
}

export class NotVerifiedError extends Error {
  constructor() {
    super('this item was not verified against the chain, so it was not opened');
    this.name = 'NotVerifiedError';
  }
}

/**
 * Decrypts an inherited item — and refuses to unless it verified first.
 *
 * The verdict is a required argument rather than something a caller may skip,
 * because "verify, then decrypt" is only a rule if the code cannot do the second
 * without the first. Showing an heir content that failed verification, even
 * behind a warning, is the failure mode this whole mechanism exists to prevent.
 */
export async function openInherited(
  content: InheritedContent,
  wrappedItemKey: string,
  verdict: ClaimVerdict,
  decryptors: ClaimDecryptors,
): Promise<OpenedInheritance> {
  if (!verdict.verified) {
    throw new NotVerifiedError();
  }

  const dek = await decryptors.unwrapItemKey(wrappedItemKey);

  try {
    if (content.item_type === 'document') {
      const document = await decryptors.openDocument(content, dek);

      return { text: document.text, unverifiedEdits: document.appliedDeltas };
    }

    return {
      text: await decryptors.openText(content.ciphertext ?? '', dek),
      unverifiedEdits: 0,
    };
  } finally {
    dek.fill(0);
  }
}
