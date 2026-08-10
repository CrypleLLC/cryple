export class LabelKeyNotSpecifiedError extends Error {
  constructor(operation: string) {
    super(
      `${operation} is unavailable: the owner-side key that should seal an heir label is not ` +
        'specified yet. Decision A (Cryple-Key-v1|vault-kek, ../api-general/.docs/crypto/' +
        'ECDSA.md § Step 5) closed the equivalent gap for wrapped_dek, but its ratified scope ' +
        'excludes this field — it "never encrypts application data directly." Do not substitute ' +
        'another key here: reusing an identity or encryption key, or the vault KEK outside its ' +
        'stated scope, is exactly the invention that spec exists to prevent.',
    );
    this.name = 'LabelKeyNotSpecifiedError';
  }
}

export interface LabelSealer {
  sealLabel(plaintext: string): Promise<string>;
  openLabel(sealed: string): Promise<string>;
}

export const unspecifiedLabelSealer: LabelSealer = {
  sealLabel() {
    return Promise.reject(new LabelKeyNotSpecifiedError('sealLabel'));
  },
  openLabel() {
    return Promise.reject(new LabelKeyNotSpecifiedError('openLabel'));
  },
};

export const LABEL_SEALED_NOTICE =
  'Naming an heir is unavailable in this build. The private note attached to an heir has to be ' +
  'encrypted before it leaves this device, and the key that does that is not specified yet. ' +
  'Existing heirs are listed and can be removed.';

export function isLabelSealed(error: unknown): boolean {
  return error instanceof LabelKeyNotSpecifiedError;
}
