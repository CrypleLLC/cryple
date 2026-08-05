import { combine as sssCombine, split as sssSplit } from 'shamir-secret-sharing';
import { RecoveryValidationError } from './errors';

export const MIN_SHARES = 1;
export const MAX_SHARES = 255;
export const USER_SHARE_INDEX = 0;

export interface RekShare {
  shareIndex: number;
  bytes: Uint8Array;
}

export interface SplitConfig {
  shares: number;
  threshold: number;
}

export class ThresholdError extends RecoveryValidationError {
  constructor(message: string) {
    super(message, 'ThresholdError');
  }
}

export function shareCountForGuardians(guardianCount: number): number {
  return guardianCount + 1;
}

export function effectiveQuorum(configuredThreshold: number, activeGuardians: number): number {
  return Math.min(configuredThreshold, activeGuardians);
}

export function requiresSoleGuardianWarning(config: SplitConfig): boolean {
  return config.threshold === 1 && config.shares > 1;
}

export function validateSplitConfig(config: SplitConfig): void {
  const { shares, threshold } = config;

  if (!Number.isInteger(shares) || shares < MIN_SHARES || shares > MAX_SHARES) {
    throw new ThresholdError(
      `n_shares must be an integer between ${MIN_SHARES} and ${MAX_SHARES}, got ${shares}`,
    );
  }
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new ThresholdError(`k_threshold must be a positive integer, got ${threshold}`);
  }
  if (threshold > shares) {
    throw new ThresholdError(
      `k_threshold (${threshold}) cannot exceed n_shares (${shares})`,
    );
  }
}

function distinctCoordinates(count: number): Uint8Array {
  const pool = Uint8Array.from({ length: MAX_SHARES }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.subarray(0, count);
}

function splitAtThresholdOne(secret: Uint8Array, shares: number): Uint8Array[] {
  const coordinates = distinctCoordinates(shares);
  return Array.from({ length: shares }, (_, i) => {
    const share = new Uint8Array(secret.length + 1);
    share.set(secret, 0);
    share[secret.length] = coordinates[i];
    return share;
  });
}

export async function splitSecret(
  secret: Uint8Array,
  config: SplitConfig,
): Promise<RekShare[]> {
  validateSplitConfig(config);

  const raw =
    config.threshold === 1
      ? splitAtThresholdOne(secret, config.shares)
      : await sssSplit(secret, config.shares, config.threshold);

  return raw.map((bytes, shareIndex) => ({ shareIndex, bytes }));
}

export async function combineSecret(shares: readonly Uint8Array[]): Promise<Uint8Array> {
  if (shares.length === 0) {
    throw new ThresholdError('at least one share is required to reconstruct');
  }
  if (shares.length === 1) {
    const only = shares[0];
    if (only.length < 2) {
      throw new ThresholdError('a share must be at least 2 bytes');
    }
    return only.slice(0, only.length - 1);
  }
  return sssCombine([...shares]);
}
