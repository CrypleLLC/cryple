import { describe, expect, it } from 'vitest';
import { assertValidPin, validatePin } from './index';

describe('PIN format rules', () => {
  it('accepts a well-formed PIN', () => {
    expect(validatePin('428193')).toEqual({ valid: true });
    expect(() => assertValidPin('428193')).not.toThrow();
  });

  it('rejects the wrong length', () => {
    expect(validatePin('12345')).toEqual({ valid: false, reason: 'wrong-length' });
    expect(validatePin('1234567')).toEqual({ valid: false, reason: 'wrong-length' });
    expect(validatePin('')).toEqual({ valid: false, reason: 'wrong-length' });
  });

  it('rejects non-ASCII-digit characters', () => {
    expect(validatePin('12345a')).toEqual({ valid: false, reason: 'non-digit' });
    expect(validatePin('12 456')).toEqual({ valid: false, reason: 'non-digit' });
    expect(validatePin('١٢٣٤٥٦')).toEqual({ valid: false, reason: 'non-digit' });
  });

  it('rejects all-repeating digits', () => {
    for (const digit of '0123456789') {
      expect(validatePin(digit.repeat(6))).toEqual({
        valid: false,
        reason: 'repeating-digit',
      });
    }
  });

  it('rejects ascending and descending runs', () => {
    expect(validatePin('123456')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('012345')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('456789')).toEqual({ valid: false, reason: 'ascending-sequence' });
    expect(validatePin('654321')).toEqual({ valid: false, reason: 'descending-sequence' });
    expect(validatePin('987654')).toEqual({ valid: false, reason: 'descending-sequence' });
  });

  it('allows near-sequences that are not strict runs', () => {
    expect(validatePin('123457').valid).toBe(true);
    expect(validatePin('112233').valid).toBe(true);
  });
});
