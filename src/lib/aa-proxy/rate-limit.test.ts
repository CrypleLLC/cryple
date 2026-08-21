import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUESTS_PER_MINUTE,
  RateLimiter,
  WINDOW_MS,
  clientKey,
  readRequestsPerMinute,
} from './rate-limit';

describe('RateLimiter', () => {
  it('allows up to the limit and refuses the next request', () => {
    const limiter = new RateLimiter(3);
    const now = 1_000_000;

    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now).allowed).toBe(true);

    const refused = limiter.check('a', now);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each client key independently', () => {
    const limiter = new RateLimiter(1);
    const now = 1_000_000;

    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('b', now).allowed).toBe(true);
    expect(limiter.check('a', now).allowed).toBe(false);
  });

  it('reopens the window once it has elapsed', () => {
    const limiter = new RateLimiter(1);
    const now = 1_000_000;

    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now + WINDOW_MS - 1).allowed).toBe(false);
    expect(limiter.check('a', now + WINDOW_MS).allowed).toBe(true);
  });

  it('absorbs a full heartbeat receipt poll at the default limit', () => {
    const limiter = new RateLimiter(DEFAULT_REQUESTS_PER_MINUTE);
    const now = 1_000_000;

    for (let attempt = 0; attempt < 42; attempt += 1) {
      expect(limiter.check('a', now).allowed, `attempt ${attempt}`).toBe(true);
    }
  });
});

describe('readRequestsPerMinute', () => {
  it('falls back on absent, zero, negative and non-numeric values', () => {
    for (const value of [undefined, '', '0', '-5', 'many']) {
      expect(readRequestsPerMinute(value)).toBe(DEFAULT_REQUESTS_PER_MINUTE);
    }
  });

  it('honours a positive override', () => {
    expect(readRequestsPerMinute('30')).toBe(30);
  });
});

describe('clientKey', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientKey('203.0.113.7, 70.41.3.18', null)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to a shared bucket', () => {
    expect(clientKey(null, '203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey(null, null)).toBe('unknown');
    expect(clientKey('  ', '  ')).toBe('unknown');
  });
});
