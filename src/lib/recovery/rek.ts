import { openText, sealText } from '@/lib/sealed';
import { zeroBytes } from '@/lib/encoding';
import { assertValidMnemonic } from '@/lib/keys';
import {
  combineSecret,
  splitSecret,
  validateSplitConfig,
  type RekShare,
  type SplitConfig,
} from './shamir';

export const REK_LENGTH = 32;

export function generateRek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(REK_LENGTH));
}

export async function encryptSeedPhrase(
  seedPhrase: string,
  rek: Uint8Array,
): Promise<string> {
  assertValidMnemonic(seedPhrase);
  return sealText(seedPhrase, rek);
}

export async function decryptSeedPhrase(
  encryptedSeed: string,
  rek: Uint8Array,
): Promise<string> {
  return openText(encryptedSeed, rek);
}

export interface RecoveryVaultMaterial {
  encryptedSeed: string;
  shares: RekShare[];
  config: SplitConfig;
}

export async function buildRecoveryVault(
  seedPhrase: string,
  config: SplitConfig,
): Promise<RecoveryVaultMaterial> {
  validateSplitConfig(config);

  const rek = generateRek();
  try {
    const encryptedSeed = await encryptSeedPhrase(seedPhrase, rek);
    const shares = await splitSecret(rek, config);
    return { encryptedSeed, shares, config };
  } finally {
    zeroBytes(rek);
  }
}

export async function recoverSeedPhrase(
  encryptedSeed: string,
  shares: readonly Uint8Array[],
): Promise<string> {
  const rek = await combineSecret(shares);
  try {
    return await decryptSeedPhrase(encryptedSeed, rek);
  } finally {
    zeroBytes(rek);
  }
}
