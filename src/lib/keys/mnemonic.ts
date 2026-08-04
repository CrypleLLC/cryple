import { generateMnemonic as bip39Generate, validateMnemonic as bip39Validate } from 'bip39';
import { utf8ToBytes } from '@/lib/encoding';

export const SEED_LENGTH = 64;
export const SUPPORTED_WORD_COUNTS = [12, 24] as const;

const BIP39_ITERATIONS = 2048;
const BIP39_SALT_PREFIX = 'mnemonic';

export type MnemonicWordCount = (typeof SUPPORTED_WORD_COUNTS)[number];

function normalize(text: string): string {
  return text.normalize('NFKD');
}

export function countWords(mnemonic: string): number {
  return normalize(mnemonic).trim().split(/\s+/).filter(Boolean).length;
}

export function isValidMnemonic(mnemonic: string): boolean {
  const wordCount = countWords(mnemonic);
  if (!SUPPORTED_WORD_COUNTS.includes(wordCount as MnemonicWordCount)) {
    return false;
  }
  return bip39Validate(normalize(mnemonic).trim().replace(/\s+/g, ' '));
}

export function assertValidMnemonic(mnemonic: string): void {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('invalid mnemonic: unsupported word count or failed checksum');
  }
}

export function generateMnemonic(wordCount: MnemonicWordCount = 12): string {
  return bip39Generate(wordCount === 24 ? 256 : 128);
}

export async function mnemonicToSeed(
  mnemonic: string,
  passphrase = '',
): Promise<Uint8Array> {
  assertValidMnemonic(mnemonic);

  const password = utf8ToBytes(normalize(mnemonic).trim().replace(/\s+/g, ' '));
  const salt = utf8ToBytes(BIP39_SALT_PREFIX + normalize(passphrase));

  const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt, iterations: BIP39_ITERATIONS },
    key,
    SEED_LENGTH * 8,
  );

  return new Uint8Array(bits);
}
