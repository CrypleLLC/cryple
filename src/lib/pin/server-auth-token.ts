import { bytesToHex, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { stretchPin } from './kdf';

const USER_ADDRESS_PATTERN = /^[0-9a-f]{64}$/;

export function assertCanonicalUserAddress(userAddress: string): void {
  if (!USER_ADDRESS_PATTERN.test(userAddress)) {
    throw new Error('user_address must be 64 lowercase hex characters');
  }
}

export async function deriveServerAuthTokenBytes(
  pin: string,
  userAddress: string,
): Promise<Uint8Array> {
  assertCanonicalUserAddress(userAddress);
  return stretchPin(pin, utf8ToBytes(userAddress));
}

export async function deriveServerAuthToken(
  pin: string,
  userAddress: string,
): Promise<string> {
  const derived = await deriveServerAuthTokenBytes(pin, userAddress);
  const token = bytesToHex(derived);
  zeroBytes(derived);
  return token;
}
