export type { DekWrapper, WrappedDek } from '@/lib/keyrings/items';

export const DEK_LENGTH = 32;

export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_LENGTH));
}
