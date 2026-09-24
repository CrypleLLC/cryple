import { describe, expect, it } from 'vitest';
import {
  CONTENT_SECURITY_POLICY_HEADER,
  ObjectStoreOriginsError,
  connectSources,
  contentSecurityPolicy,
  objectStoreUrlsFrom,
  originOf,
  requireObjectStoreOrigins,
  securityHeaders,
} from './index';

function directive(policy: string, name: string): string[] | undefined {
  const found = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([candidate]) => candidate === name);
  return found?.slice(1);
}

const options = {
  apiUrl: 'https://api.cryple.example/',
  objectStoreUrls: ['https://account.r2.cloudflarestorage.com/cryple-files'],
};

describe('originOf', () => {
  it('keeps the origin and drops the path', () => {
    expect(originOf('https://api.cryple.example/v9/secrets?x=1')).toBe('https://api.cryple.example');
    expect(originOf('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('refuses anything that is not an http origin', () => {
    expect(originOf('')).toBeUndefined();
    expect(originOf('not a url')).toBeUndefined();
    expect(originOf('javascript:alert(1)')).toBeUndefined();
    expect(originOf('data:text/plain,hi')).toBeUndefined();
  });
});

describe('objectStoreUrlsFrom', () => {
  it('splits a comma-separated variable and ignores blanks', () => {
    expect(objectStoreUrlsFrom(' https://a.example , ,https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(objectStoreUrlsFrom(undefined)).toEqual([]);
  });
});

describe('requireObjectStoreOrigins', () => {
  it('returns each origin once', () => {
    expect(
      requireObjectStoreOrigins([
        'https://account.r2.cloudflarestorage.com/cryple-files',
        'https://account.r2.cloudflarestorage.com',
      ]),
    ).toEqual(['https://account.r2.cloudflarestorage.com']);
  });

  it('refuses to build a production policy with no object store, which would block the drive', () => {
    expect(() => requireObjectStoreOrigins([])).toThrow(ObjectStoreOriginsError);
    expect(() => requireObjectStoreOrigins([])).toThrow(/CSP_OBJECT_STORE_ORIGINS is not set/);
  });

  it('names an entry that is not a URL rather than silently dropping it', () => {
    expect(() =>
      requireObjectStoreOrigins(['https://account.r2.cloudflarestorage.com', 'account.r2.cloudflarestorage.com']),
    ).toThrow(/"account\.r2\.cloudflarestorage\.com"/);
  });
});

describe('connectSources', () => {
  it('names exactly this origin, the API and the object stores, once each', () => {
    expect(
      connectSources({ ...options, objectStoreUrls: [...options.objectStoreUrls, 'https://api.cryple.example'] }),
    ).toEqual(["'self'", 'https://api.cryple.example', 'https://account.r2.cloudflarestorage.com']);
  });
});

describe('contentSecurityPolicy', () => {
  it('never allows a wildcard or a bare scheme that would let data reach any host', () => {
    const policy = contentSecurityPolicy(options);
    for (const part of policy.split(';')) {
      const sources = part.trim().split(/\s+/).slice(1);
      expect(sources).not.toContain('*');
      expect(sources).not.toContain('https:');
      expect(sources).not.toContain('http:');
    }
  });

  it('limits images to this origin and to bytes decrypted in the tab', () => {
    expect(directive(contentSecurityPolicy(options), 'img-src')).toEqual(["'self'", 'blob:', 'data:']);
  });

  it('allows eval only for the development server', () => {
    expect(directive(contentSecurityPolicy(options), 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(contentSecurityPolicy({ ...options, development: true }), 'script-src')).toContain(
      "'unsafe-eval'",
    );
  });

  it('forbids framing, plugins, base rewriting and form submissions', () => {
    const policy = contentSecurityPolicy(options);
    for (const name of ['frame-ancestors', 'frame-src', 'object-src', 'base-uri', 'form-action']) {
      expect(directive(policy, name)).toEqual(["'none'"]);
    }
  });
});

describe('securityHeaders', () => {
  it('enforces the whole policy and sends no report-only copy', () => {
    const headers = securityHeaders(options);
    const byKey = new Map(headers.map((header) => [header.key, header.value]));

    expect(byKey.get(CONTENT_SECURITY_POLICY_HEADER)).toBe(contentSecurityPolicy(options));
    expect([...byKey.keys()].some((key) => /report-only/i.test(key))).toBe(false);
    expect(byKey.get('X-Frame-Options')).toBe('DENY');
    expect(byKey.get('Referrer-Policy')).toBe('no-referrer');
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
