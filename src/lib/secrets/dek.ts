export const DEK_LENGTH = 32;

export class KekNotSpecifiedError extends Error {
  constructor(operation: string) {
    super(
      `${operation} is unavailable: the owner-side KEK derivation is not specified. ` +
        'It belongs in ../api-general/.docs/crypto/ECDSA.md with regenerated test vectors ' +
        '(backend Task 59/63). Do not invent one here — the server treats wrapped_dek as ' +
        'opaque, so a divergent choice fails silently, per item, forever.',
    );
    this.name = 'KekNotSpecifiedError';
  }
}

export interface DekWrapper {
  wrapDek(dek: Uint8Array): Promise<string>;
  unwrapDek(wrapped: string): Promise<Uint8Array>;
}

export const unspecifiedDekWrapper: DekWrapper = {
  wrapDek() {
    return Promise.reject(new KekNotSpecifiedError('wrapDek'));
  },
  unwrapDek() {
    return Promise.reject(new KekNotSpecifiedError('unwrapDek'));
  },
};

export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_LENGTH));
}
