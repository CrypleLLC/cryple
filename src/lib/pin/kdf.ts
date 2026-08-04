export const PIN_PBKDF2_ITERATIONS = 600_000;
export const PIN_PBKDF2_OUTPUT_LENGTH = 32;

import { utf8ToBytes } from '@/lib/encoding';

export async function stretchPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8ToBytes(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PIN_PBKDF2_ITERATIONS,
    },
    key,
    PIN_PBKDF2_OUTPUT_LENGTH * 8,
  );
  return new Uint8Array(bits);
}
