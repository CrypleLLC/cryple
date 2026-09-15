export interface SecurityHeaderOptions {
  apiUrl: string;
  objectStoreUrls?: readonly string[];
  development?: boolean;
}

export interface HeaderEntry {
  key: string;
  value: string;
}

type Directive = readonly [name: string, sources: readonly string[]];

export const CONTENT_SECURITY_POLICY_HEADER = 'Content-Security-Policy';
export const OBJECT_STORE_ORIGINS_VARIABLE = 'CSP_OBJECT_STORE_ORIGINS';

export class ObjectStoreOriginsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectStoreOriginsError';
  }
}

export function originOf(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const { origin, protocol } = new URL(trimmed);
    return protocol === 'https:' || protocol === 'http:' ? origin : undefined;
  } catch {
    return undefined;
  }
}

function serialize(directives: readonly Directive[]): string {
  return directives.map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

export function connectSources(options: SecurityHeaderOptions): string[] {
  const origins = [options.apiUrl, ...(options.objectStoreUrls ?? [])]
    .map(originOf)
    .filter((origin): origin is string => origin !== undefined);

  return ["'self'", ...new Set(origins)];
}

export function contentSecurityPolicy(options: SecurityHeaderOptions): string {
  const scripts = ["'self'", "'unsafe-inline'", ...(options.development ? ["'unsafe-eval'"] : [])];

  return serialize([
    ['default-src', ["'self'"]],
    ['script-src', scripts],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'blob:', 'data:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connectSources(options)],
    ['media-src', ["'self'", 'blob:']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
  ]);
}

export function objectStoreUrlsFrom(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function requireObjectStoreOrigins(urls: readonly string[]): string[] {
  const unparsable = urls.filter((url) => originOf(url) === undefined);
  if (unparsable.length > 0) {
    throw new ObjectStoreOriginsError(
      `${OBJECT_STORE_ORIGINS_VARIABLE} holds ${unparsable.map((url) => `"${url}"`).join(', ')}, ` +
        'which is not an http(s) URL. The Content Security Policy would leave it out and every ' +
        'drive upload and download to it would be blocked.',
    );
  }

  const origins = [...new Set(urls.map((url) => originOf(url) as string))];
  if (origins.length === 0) {
    throw new ObjectStoreOriginsError(
      `${OBJECT_STORE_ORIGINS_VARIABLE} is not set. A production build enforces a Content Security ` +
        'Policy whose connect-src must name the object store presigned URLs point at — the API\'s ' +
        'R2_ENDPOINT, e.g. https://<account-id>.r2.cloudflarestorage.com. Without it every drive ' +
        'upload and download is blocked. See src/lib/security-headers/README.md.',
    );
  }

  return origins;
}

export function securityHeaders(options: SecurityHeaderOptions): HeaderEntry[] {
  return [
    { key: CONTENT_SECURITY_POLICY_HEADER, value: contentSecurityPolicy(options) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ];
}
