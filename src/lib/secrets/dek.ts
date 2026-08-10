import { sealPayload, openPayload } from './codec';

export const DEK_LENGTH = 32;

export interface DekWrapper {
  wrapDek(dek: Uint8Array): Promise<string>;
  unwrapDek(wrapped: string): Promise<Uint8Array>;
}

export function vaultKekDekWrapper(vaultKek: Uint8Array): DekWrapper {
  return {
    wrapDek: (dek) => sealPayload(dek, vaultKek),
    unwrapDek: (wrapped) => openPayload(wrapped, vaultKek),
  };
}

export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_LENGTH));
}
