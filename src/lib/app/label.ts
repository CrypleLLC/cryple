import { openText, sealText } from '@/lib/sealed';

export interface LabelSealer {
  sealLabel(plaintext: string): Promise<string>;
  openLabel(sealed: string): Promise<string>;
}

export const UNREADABLE_LABEL = '(cannot be read on this device)';

/**
 * Seals `beneficiaries.encrypted_label`, the owner's private note naming an heir.
 *
 * The key is the fifth leaf of the frozen tree — `Cryple-Key-v1|heir-label`,
 * `crypto/ECDSA.md` § Step 6 — and deliberately **not** the vault KEK, whose
 * ratified scope is wrapping other keys and never encrypting application data.
 * A label is application data.
 *
 * **The plaintext is UTF-8 with no normalization.** Seal the bytes the user
 * typed. Applying NFC or NFKD here produces a blob the owner's other devices
 * decrypt to a different string, and nothing surfaces the divergence until they
 * compare two devices — which is why the test vector's plaintext is deliberately
 * non-ASCII.
 */
export function heirLabelSealer(heirLabelKey: Uint8Array): LabelSealer {
  return {
    sealLabel: (plaintext) => sealText(plaintext, heirLabelKey),
    openLabel: (sealed) => openText(sealed, heirLabelKey),
  };
}

/**
 * Opens a label for display, or says it could not be opened.
 *
 * A label is a convenience, not a key: an unopenable one must not stop an heir
 * from being listed, removed, or assigned anything — all of which depend on the
 * key snapshot and the username, neither of which is in here.
 */
export async function readLabel(sealer: LabelSealer, sealed: string): Promise<string> {
  try {
    return await sealer.openLabel(sealed);
  } catch {
    return UNREADABLE_LABEL;
  }
}
