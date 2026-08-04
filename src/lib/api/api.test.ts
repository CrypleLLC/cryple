import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  canonicalizeUuid,
  collectPages,
  decodeJwtClaims,
  getBaseUrl,
  isCanonicalUuid,
  isJwtExpired,
  request,
  TokenStore,
  userMessageFor,
  assertValidLimit,
  GENERIC_AUTH_FAILURE,
  MAX_BODY_BYTES,
  RequestTooLargeError,
  NetworkError,
} from './index';

interface FakeResponse {
  status: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
}

function mockFetch(...responses: FakeResponse[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;

  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const spec = responses[Math.min(index++, responses.length - 1)];
    const text = spec.raw ?? (spec.body === undefined ? '' : JSON.stringify(spec.body));
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      text: async () => text,
      headers: { get: (name: string) => spec.headers?.[name] ?? null },
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_BASE_API_URL;
});

describe('base URL', () => {
  it('defaults to localhost with the version segment', () => {
    expect(getBaseUrl()).toBe('http://localhost:8080/v1');
  });

  it('takes NEXT_PUBLIC_BASE_API_URL and strips trailing slashes', () => {
    process.env.NEXT_PUBLIC_BASE_API_URL = 'https://api.cryple.io/v1/';
    expect(getBaseUrl()).toBe('https://api.cryple.io/v1');
  });

  it('concatenates documented paths onto the versioned base', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: {} } });
    await request({ method: 'GET', path: '/users/me' });
    expect(calls[0].url).toBe('http://localhost:8080/v1/users/me');
  });
});

describe('request shape', () => {
  it('sends only Content-Type and Authorization, and never credentials', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: {} } });
    await request({ method: 'POST', path: '/secrets', body: { a: 1 }, token: 'jwt-value' });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type']);
    expect(headers.Authorization).toBe('Bearer jwt-value');
    expect(calls[0].init).not.toHaveProperty('credentials');
  });

  it('omits Content-Type when there is no body', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: {} } });
    await request({ method: 'GET', path: '/users/me', token: 'jwt' });
    expect(Object.keys(calls[0].init.headers as object)).toEqual(['Authorization']);
  });

  it('appends query parameters and skips undefined ones', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: [] } });
    await request({
      method: 'GET',
      path: '/secrets',
      query: { fields: 'meta', limit: 25, cursor: undefined },
    });
    expect(calls[0].url).toBe('http://localhost:8080/v1/secrets?fields=meta&limit=25');
  });

  it('refuses a body over the 1 MiB cap before sending', async () => {
    mockFetch({ status: 200, body: {} });
    const oversized = { blob: 'x'.repeat(MAX_BODY_BYTES) };
    await expect(request({ method: 'POST', path: '/secrets', body: oversized })).rejects.toThrow(
      RequestTooLargeError,
    );
  });

  it('wraps a transport failure rather than leaking it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch'); }));
    await expect(request({ method: 'GET', path: '/users/me' })).rejects.toThrow(NetworkError);
  });
});

describe('status handling is by response, never by verb', () => {
  it('reads 204 as no body at all', async () => {
    mockFetch({ status: 204 });
    const response = await request({ method: 'DELETE', path: '/secrets/abc' });
    expect(response.status).toBe(204);
    expect(response.data).toBeUndefined();
  });

  it('reads a DELETE that answers 200 with a body', async () => {
    mockFetch({
      status: 200,
      body: { message: 'Guardian removed', data: { share_removed: true, votes_withdrawn: 2 } },
    });
    const response = await request<{ share_removed: boolean; votes_withdrawn: number }>({
      method: 'DELETE',
      path: '/recovery/guardians/abc',
    });
    expect(response.data).toEqual({ share_removed: true, votes_withdrawn: 2 });
  });

  it('distinguishes 201 created from 200 already existed', async () => {
    mockFetch({ status: 201, body: { message: 'Account created', data: { access_token: 't' } } });
    expect((await request({ method: 'POST', path: '/sign-up' })).status).toBe(201);
  });
});

describe('error envelope', () => {
  it('carries only a code — there is no message field', async () => {
    mockFetch({ status: 409, body: { code: 'CONFLICT' } });
    const error = await request({ method: 'PATCH', path: '/auth/pin-reset/confirm' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('CONFLICT');
    expect(error.status).toBe(409);
    expect(error.endpoint).toBe('PATCH /auth/pin-reset/confirm');
  });

  it('separates 401 UNAUTHORIZED from 401 INVALID_CREDENTIALS', async () => {
    mockFetch({ status: 401, body: { code: 'UNAUTHORIZED' } });
    const expired = await request({ method: 'GET', path: '/users/me' }).catch((e) => e);
    expect(expired.isSessionOver).toBe(true);
    expect(expired.isCredentialFailure).toBe(false);

    mockFetch({ status: 401, body: { code: 'INVALID_CREDENTIALS' } });
    const credentials = await request({ method: 'GET', path: '/users/me' }).catch((e) => e);
    expect(credentials.isSessionOver).toBe(false);
    expect(credentials.isCredentialFailure).toBe(true);
  });

  it('survives the router plain-text 404 that carries no JSON', async () => {
    mockFetch({ status: 404, raw: '404 page not found', headers: {} });
    const error = await request({ method: 'GET', path: '/nope' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('captures the Allow header on a 405', async () => {
    mockFetch({ status: 405, body: { code: 'METHOD_NOT_ALLOWED' }, headers: { Allow: 'GET, PATCH' } });
    const error = await request({ method: 'POST', path: '/auth/pin-reset/confirm' }).catch((e) => e);
    expect(error.allow).toBe('GET, PATCH');
  });
});

describe('user-facing copy is built client-side from code plus endpoint', () => {
  it('renders one generic message for every auth 404', () => {
    for (const path of ['/sign-up', '/sign-in', '/auth/verify']) {
      const error = new ApiError({ code: 'NOT_FOUND', status: 404, endpoint: `POST ${path}` });
      expect(userMessageFor(error)).toBe(GENERIC_AUTH_FAILURE);
    }
  });

  it('distinguishes an expired session from a credential failure', () => {
    const expired = new ApiError({ code: 'UNAUTHORIZED', status: 401, endpoint: 'GET /users/me' });
    const credentials = new ApiError({
      code: 'INVALID_CREDENTIALS',
      status: 401,
      endpoint: 'GET /users/me',
    });
    expect(userMessageFor(expired)).toMatch(/expired/i);
    expect(userMessageFor(credentials)).not.toBe(userMessageFor(expired));
  });
});

describe('UUID canonicalization at the edge', () => {
  const canonical = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('accepts only the canonical spelling', () => {
    expect(isCanonicalUuid(canonical)).toBe(true);
    expect(isCanonicalUuid(canonical.toUpperCase())).toBe(false);
    expect(isCanonicalUuid('3f2504e04f8911d39a0c0305e82c3301')).toBe(false);
    expect(isCanonicalUuid(`urn:uuid:${canonical}`)).toBe(false);
    expect(isCanonicalUuid(`{${canonical}}`)).toBe(false);
  });

  it('converts the four rejected spellings once, at the edge', () => {
    expect(canonicalizeUuid(canonical.toUpperCase())).toBe(canonical);
    expect(canonicalizeUuid('3f2504e04f8911d39a0c0305e82c3301')).toBe(canonical);
    expect(canonicalizeUuid(`urn:uuid:${canonical}`)).toBe(canonical);
    expect(canonicalizeUuid(`{${canonical}}`)).toBe(canonical);
  });

  it('throws on something that is not a UUID at all', () => {
    expect(() => canonicalizeUuid('not-a-uuid')).toThrow(/canonical/);
  });
});

describe('pagination', () => {
  it('follows next_cursor until has_more is false', async () => {
    const pages = [
      { status: 200, body: { data: [1, 2], page: { next_cursor: 'c1', has_more: true } } },
      { status: 200, body: { data: [3], page: { next_cursor: 'c2', has_more: true } } },
      { status: 200, body: { data: [4, 5], page: { has_more: false } } },
    ];
    let index = 0;
    const seen: (string | undefined)[] = [];

    const all = await collectPages<number>(async ({ cursor }) => {
      seen.push(cursor);
      const body = pages[index++].body as { data: number[]; page: { next_cursor?: string; has_more: boolean } };
      return { status: 200, data: body.data, page: body.page };
    });

    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([undefined, 'c1', 'c2']);
  });

  it('does not stop on a short page — only has_more ends the loop', async () => {
    const responses = [
      { data: [1], page: { next_cursor: 'c1', has_more: true } },
      { data: [2, 3], page: { has_more: false } },
    ];
    let index = 0;
    const all = await collectPages<number>(async () => ({ status: 200, ...responses[index++] }));
    expect(all).toEqual([1, 2, 3]);
  });

  it('stops on a response with no page object', async () => {
    const all = await collectPages<number>(async () => ({ status: 200, data: [1, 2] }));
    expect(all).toEqual([1, 2]);
  });

  it('validates limit against the documented range', () => {
    expect(assertValidLimit(200)).toBe(200);
    expect(() => assertValidLimit(0)).toThrow();
    expect(() => assertValidLimit(201)).toThrow();
    expect(() => assertValidLimit(1.5)).toThrow();
  });
});

describe('JWT lifecycle', () => {
  function makeJwt(claims: Record<string, unknown>): string {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`;
  }

  it('reads the exp claim without verifying the token', () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    expect(decodeJwtClaims(makeJwt({ exp, user_address: 'abc' }))?.exp).toBe(exp);
  });

  it('treats an elapsed exp as expired', () => {
    expect(isJwtExpired(makeJwt({ exp: Math.floor(Date.now() / 1000) - 1 }))).toBe(true);
    expect(isJwtExpired(makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }))).toBe(false);
  });

  it('stores, reports and drops the token — deleting our copy is the whole logout', () => {
    const store = new TokenStore();
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

    expect(store.isAuthenticated).toBe(false);
    store.set(token);
    expect(store.get()).toBe(token);
    expect(store.isAuthenticated).toBe(true);

    store.clear();
    expect(store.get()).toBeUndefined();
  });

  it('self-clears an expired token on read', () => {
    const store = new TokenStore();
    store.set(makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 }));
    expect(store.get()).toBeUndefined();
    expect(store.isAuthenticated).toBe(false);
  });

  it('notifies listeners on set and clear', () => {
    const store = new TokenStore();
    const seen: (string | undefined)[] = [];
    store.onChange((token) => seen.push(token));

    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    store.set(token);
    store.clear();

    expect(seen).toEqual([token, undefined]);
  });

  it('tolerates a token that is not a JWT at all', () => {
    expect(decodeJwtClaims('not.a.jwt')).toBeUndefined();
    expect(decodeJwtClaims('opaque')).toBeUndefined();
    expect(isJwtExpired('opaque')).toBe(false);
  });
});
