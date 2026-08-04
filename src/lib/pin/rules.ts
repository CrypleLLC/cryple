export const PIN_LENGTH = 6;

export type PinRejection =
  | 'wrong-length'
  | 'non-digit'
  | 'repeating-digit'
  | 'ascending-sequence'
  | 'descending-sequence';

export type PinValidation = { valid: true } | { valid: false; reason: PinRejection };

function isStrictRun(pin: string, step: number): boolean {
  for (let i = 1; i < pin.length; i++) {
    if (pin.charCodeAt(i) - pin.charCodeAt(i - 1) !== step) {
      return false;
    }
  }
  return true;
}

export function validatePin(pin: string): PinValidation {
  if (pin.length !== PIN_LENGTH) {
    return { valid: false, reason: 'wrong-length' };
  }
  if (!/^[0-9]{6}$/.test(pin)) {
    return { valid: false, reason: 'non-digit' };
  }
  if (isStrictRun(pin, 0)) {
    return { valid: false, reason: 'repeating-digit' };
  }
  if (isStrictRun(pin, 1)) {
    return { valid: false, reason: 'ascending-sequence' };
  }
  if (isStrictRun(pin, -1)) {
    return { valid: false, reason: 'descending-sequence' };
  }
  return { valid: true };
}

export function assertValidPin(pin: string): void {
  const result = validatePin(pin);
  if (!result.valid) {
    throw new Error(`invalid PIN: ${result.reason}`);
  }
}
