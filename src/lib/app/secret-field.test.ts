import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MANAGER_IGNORE,
  TEXT_SECURITY_CLASS,
  secretInputAttributes,
  supportsTextSecurity,
} from './secret-field';

describe('secretInputAttributes', () => {
  it('masks with CSS on a text input where the browser can, so no password manager treats it as a password', () => {
    const attributes = secretInputAttributes(true, true);

    expect(attributes.type).toBe('text');
    expect(attributes.className).toBe(TEXT_SECURITY_CLASS);
  });

  it('falls back to a password input only where CSS masking is unavailable', () => {
    const attributes = secretInputAttributes(true, false);

    expect(attributes.type).toBe('password');
    expect(attributes.className).toBeUndefined();
  });

  it('shows the value as plain text once revealed, whatever the browser supports', () => {
    for (const cssMasking of [true, false]) {
      const attributes = secretInputAttributes(false, cssMasking);
      expect(attributes.type).toBe('text');
      expect(attributes.className).toBeUndefined();
    }
  });

  it('tells password managers to leave the field alone in every state', () => {
    for (const masked of [true, false]) {
      for (const cssMasking of [true, false]) {
        const attributes = secretInputAttributes(masked, cssMasking);
        expect(attributes).toMatchObject(PASSWORD_MANAGER_IGNORE);
        expect(attributes.autoComplete).toBe('off');
      }
    }
  });
});

describe('supportsTextSecurity', () => {
  it('asks the browser for the exact declaration', () => {
    const asked: string[] = [];
    const css = {
      supports: (property: string, value: string) => {
        asked.push(`${property}: ${value}`);
        return true;
      },
    };

    expect(supportsTextSecurity(css)).toBe(true);
    expect(asked).toEqual(['-webkit-text-security: disc']);
  });

  it('answers no when the browser says no, cannot say, or has no CSS object', () => {
    expect(supportsTextSecurity({ supports: () => false })).toBe(false);
    expect(
      supportsTextSecurity({
        supports: () => {
          throw new Error('unsupported');
        },
      }),
    ).toBe(false);
    expect(supportsTextSecurity(undefined)).toBe(false);
  });
});
