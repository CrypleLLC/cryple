import { request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { SuccessionValidationError } from './errors';

export interface AnchorChainState {
  root: string;
  matches: boolean;
}

export interface AnchorLeafSet {
  epoch: number;
  root: string;
  leaf_count: number;
  leaves: string[];
  created_at: string;
  chain?: AnchorChainState;
}

export interface AnchorSummary {
  epoch: number;
  root: string;
  leaf_count: number;
  created_at: string;
}

export class AnchorEpochConflictError extends SuccessionValidationError {
  constructor() {
    super(
      'the chain already anchored a different root for that epoch, so this leaf set cannot be ' +
        'stored against it — recompute at the current epoch',
      'AnchorEpochConflictError',
    );
  }
}

function assertEpoch(epoch: number): number {
  if (!Number.isInteger(epoch) || epoch <= 0) {
    throw new SuccessionValidationError('epoch must be a positive integer');
  }

  return epoch;
}

/**
 * Stores the ordered leaf hashes behind a root, and **must land before the
 * userOp is submitted**.
 *
 * An heir holds only their own items, so they cannot rebuild the tree from the
 * on-chain root alone — every sibling hash on the path belongs to something they
 * will never see. Leaves with no root are harmless and correctable; a root with
 * no leaves is permanent, because the epoch freezes on-chain.
 *
 * Re-sending the identical set is a `200`. A *different* set replaces the stored
 * one, which is what makes a retry after a failed anchor possible; the only
 * refusal is contradicting a root the chain has already anchored.
 */
export async function saveAnchorLeaves(
  context: AuthedContext,
  epoch: number,
  root: string,
  leaves: readonly string[],
): Promise<AnchorLeafSet> {
  if (leaves.length === 0) {
    throw new SuccessionValidationError('a leaf set cannot be empty');
  }

  const response = await request<AnchorLeafSet>({
    method: 'PUT',
    path: `/succession/anchors/${assertEpoch(epoch)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { root, leaves: [...leaves] },
  });

  return response.data;
}

export async function getAnchorLeaves(
  context: AuthedContext,
  epoch: number,
): Promise<AnchorLeafSet> {
  const response = await request<AnchorLeafSet>({
    method: 'GET',
    path: `/succession/anchors/${assertEpoch(epoch)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });

  return response.data;
}
