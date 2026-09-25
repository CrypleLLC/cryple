import { describe, expect, it } from 'vitest';
import { endedBy, formatCountdown, secondsLeft } from './pairing';

describe('the connect countdown', () => {
  it('counts whole seconds down to zero and never below', () => {
    const now = Date.parse('2026-09-24T10:00:00Z');
    expect(secondsLeft('2026-09-24T10:05:00Z', now)).toBe(300);
    expect(secondsLeft('2026-09-24T10:00:00.400Z', now)).toBe(1);
    expect(secondsLeft('2026-09-24T09:59:00Z', now)).toBe(0);
    expect(formatCountdown(300)).toBe('5:00');
    expect(formatCountdown(61)).toBe('1:01');
  });

  it('knows which statuses end the flow', () => {
    expect(endedBy('expired')).toBe('expired');
    expect(endedBy('cancelled')).toBe('cancelled');
    expect(endedBy('claimed')).toBeUndefined();
    expect(endedBy('open')).toBeUndefined();
  });
});
