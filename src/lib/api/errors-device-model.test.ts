import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  DEVICE_CHANGE_REFUSED,
  GENERIC_AUTH_FAILURE,
  SCOPE_MISSING,
  STALE_KEYS,
  TOO_MANY_DEVICES,
  parseRetryAfter,
  rateLimitMessage,
  request,
  userMessageFor,
} from './index';

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ({
        status,
        ok: status >= 200 && status < 300,
        text: async () => JSON.stringify(body),
        headers: { get: (name: string) => headers[name] ?? null },
      }) as unknown as Response,
    ),
  );
}

async function failure(path: string, method: 'GET' | 'POST' = 'POST'): Promise<ApiError> {
  return request({ method, path }).then(
    () => {
      throw new Error('expected a failure');
    },
    (error: unknown) => error as ApiError,
  );
}

describe('429 on every budget', () => {
  for (const path of [
    '/sign-in',
    '/sign-up',
    '/devices/enrol',
    '/devices/enrol/chain',
    '/oprf/account/evaluate',
    '/oprf/devices/0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e/evaluate',
    '/users/username',
    '/files',
  ]) {
    it(`reads Retry-After on ${path} and never renders it as an authentication failure`, async () => {
      respond(429, { code: 'TOO_MANY_REQUESTS' }, { 'Retry-After': '120' });
      const error = await failure(path);

      expect(error.isRateLimited).toBe(true);
      expect(error.retryAfterSeconds).toBe(120);
      const message = userMessageFor(error);
      expect(message).not.toBe(GENERIC_AUTH_FAILURE);
      expect(message).toMatch(/not a problem with your account or your PIN/);
      expect(message).toMatch(/in about 2 minutes/);
    });
  }

  it('says "in a moment" when the header is missing or unreadable', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(rateLimitMessage(undefined)).toMatch(/in a moment/);
    expect(rateLimitMessage(1)).toMatch(/in 1 second/);
    expect(rateLimitMessage(45)).toMatch(/in 45 seconds/);
  });
});

describe('the device-model codes', () => {
  it('maps STALE_KEY_GENERATION, TOO_MANY_DEVICES and INVALID_BATCH to their own sentences', async () => {
    respond(409, { code: 'STALE_KEY_GENERATION' });
    expect(userMessageFor(await failure('/secrets'))).toBe(STALE_KEYS);

    respond(409, { code: 'TOO_MANY_DEVICES' });
    expect(userMessageFor(await failure('/devices/enrol'))).toBe(TOO_MANY_DEVICES);

    respond(400, { code: 'INVALID_BATCH' });
    expect(userMessageFor(await failure('/devices/batch'))).toBe(DEVICE_CHANGE_REFUSED);
  });

  it('says a 404 on a scoped route may be a missing scope, for a device that lacks it', async () => {
    respond(404, { code: 'NOT_FOUND' });
    const error = await failure('/notes/0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e', 'GET');

    expect(userMessageFor(error, { deviceScopes: ['secrets'] })).toBe(SCOPE_MISSING);
    expect(userMessageFor(error, { deviceScopes: ['notes'] })).toBe('That item no longer exists.');
  });

  it('treats 401 UNAUTHORIZED as this device being signed out, not a wrong credential', async () => {
    respond(401, { code: 'UNAUTHORIZED' });
    const error = await failure('/users/me', 'GET');
    expect(error.isSessionOver).toBe(true);
    expect(userMessageFor(error)).toMatch(/signed out/);
  });
});
