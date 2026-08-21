import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@/lib/encoding';

export const LEAF_DOMAIN = 'cryple.vault.leaf.v1';
export const NODE_PREFIX = 0x01;

export const INHERITABLE_ITEM_TYPES = ['document', 'note', 'secret'] as const;
export type ItemType = (typeof INHERITABLE_ITEM_TYPES)[number];

export interface VaultItem {
  type: ItemType;
  id: string;
  blob: string;
}

export interface ProofStep {
  hash: Uint8Array;
  siblingIsRight: boolean;
}

export interface InclusionProof {
  type: ItemType;
  id: string;
  leaf: Uint8Array;
  index: number;
  steps: ProofStep[];
}

export class VaultMerkleError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}

export class UnknownItemTypeError extends VaultMerkleError {
  constructor(type: string) {
    super(`"${type}" is not an inheritable item type`, 'UnknownItemTypeError');
  }
}

export class EmptyItemIdError extends VaultMerkleError {
  constructor() {
    super('item id is empty', 'EmptyItemIdError');
  }
}

export class EmptyBlobError extends VaultMerkleError {
  constructor(type: string, id: string) {
    super(
      `${type} ${id} has no anchorable bytes; it must be excluded from the tree rather than hashed as empty`,
      'EmptyBlobError',
    );
  }
}

export class EmptyTreeError extends VaultMerkleError {
  constructor() {
    super('a vault with no anchorable items has no root', 'EmptyTreeError');
  }
}

export class DuplicateItemError extends VaultMerkleError {
  constructor(type: string, id: string) {
    super(`${type} ${id} appears twice`, 'DuplicateItemError');
  }
}

export class ItemNotInTreeError extends VaultMerkleError {
  constructor(type: string, id: string) {
    super(`${type} ${id} is not in the tree`, 'ItemNotInTreeError');
  }
}

export function leafPreimage(item: VaultItem): string {
  const content = bytesToHex(sha256(utf8ToBytes(item.blob)));
  return [LEAF_DOMAIN, item.type, item.id, content].join('|');
}

export function leafHash(item: VaultItem): Uint8Array {
  if (!INHERITABLE_ITEM_TYPES.includes(item.type)) {
    throw new UnknownItemTypeError(item.type);
  }
  if (item.id.length === 0) {
    throw new EmptyItemIdError();
  }
  if (item.blob.length === 0) {
    throw new EmptyBlobError(item.type, item.id);
  }

  return sha256(utf8ToBytes(leafPreimage(item)));
}

export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(new Uint8Array([NODE_PREFIX]), left, right));
}

export function largestPowerOfTwoBelow(count: number): number {
  let power = 1;
  while (power * 2 < count) {
    power *= 2;
  }
  return power;
}

export function canonicalOrder(items: readonly VaultItem[]): VaultItem[] {
  if (items.length === 0) {
    throw new EmptyTreeError();
  }

  const ordered = [...items].sort((a, b) =>
    a.type === b.type ? compareBytes(a.id, b.id) : compareBytes(a.type, b.type),
  );

  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].type === ordered[index - 1].type && ordered[index].id === ordered[index - 1].id) {
      throw new DuplicateItemError(ordered[index].type, ordered[index].id);
    }
  }

  return ordered;
}

function compareBytes(a: string, b: string): number {
  const left = utf8ToBytes(a);
  const right = utf8ToBytes(b);
  const shared = Math.min(left.length, right.length);

  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return left.length - right.length;
}

function merkleRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 1) {
    return leaves[0];
  }

  const split = largestPowerOfTwoBelow(leaves.length);
  return hashNode(merkleRoot(leaves.slice(0, split)), merkleRoot(leaves.slice(split)));
}

function auditPath(leaves: readonly Uint8Array[], index: number): ProofStep[] {
  if (leaves.length === 1) {
    return [];
  }

  const split = largestPowerOfTwoBelow(leaves.length);

  if (index < split) {
    return [
      ...auditPath(leaves.slice(0, split), index),
      { hash: merkleRoot(leaves.slice(split)), siblingIsRight: true },
    ];
  }

  return [
    ...auditPath(leaves.slice(split), index - split),
    { hash: merkleRoot(leaves.slice(0, split)), siblingIsRight: false },
  ];
}

export function orderedLeaves(items: readonly VaultItem[]): Uint8Array[] {
  return canonicalOrder(items).map(leafHash);
}

/**
 * The leaf hashes in tree order, `0x`-prefixed hex — the wire form the anchored
 * leaf set is stored in. Order is the payload: re-sorting these produces a
 * different root, and the API refuses a set that does not rebuild the one
 * declared with it.
 */
export function orderedLeafHashesHex(items: readonly VaultItem[]): string[] {
  return orderedLeaves(items).map((leaf) => `0x${bytesToHex(leaf)}`);
}

/**
 * Rebuilds the root from leaf hashes alone — the heir's side of verification.
 *
 * An heir holds one item and a list of hashes, never the other items, so they
 * cannot call `vaultRoot`. With the whole ordered leaf set in hand an inclusion
 * *proof* is redundant: rebuilding the root and finding your own leaf in the
 * list proves exactly what a proof would, and needs nothing the API withholds.
 *
 * Order is the payload. These arrive in tree order and are never re-sorted;
 * sorting hashes is not the same as sorting by (type, id), and doing it here
 * would produce a root that matches nothing.
 */
export function rootFromLeaves(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) {
    throw new EmptyTreeError();
  }

  return merkleRoot([...leaves]);
}

export function vaultRoot(items: readonly VaultItem[]): Uint8Array {
  return merkleRoot(orderedLeaves(items));
}

export function vaultRootHex(items: readonly VaultItem[]): string {
  return `0x${bytesToHex(vaultRoot(items))}`;
}

export function prove(
  items: readonly VaultItem[],
  type: ItemType,
  id: string,
): InclusionProof {
  const ordered = canonicalOrder(items);
  const index = ordered.findIndex((item) => item.type === type && item.id === id);
  if (index < 0) {
    throw new ItemNotInTreeError(type, id);
  }

  const leaves = ordered.map(leafHash);

  return {
    type,
    id,
    leaf: leaves[index],
    index,
    steps: auditPath(leaves, index),
  };
}

export function verifyProof(proof: InclusionProof, root: Uint8Array): boolean {
  let current = proof.leaf;

  for (const step of proof.steps) {
    current = step.siblingIsRight ? hashNode(current, step.hash) : hashNode(step.hash, current);
  }

  return bytesToHex(current) === bytesToHex(root);
}
