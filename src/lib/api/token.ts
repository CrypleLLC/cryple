import { base64UrlToBytes, bytesToUtf8 } from '@/lib/encoding';

export interface JwtClaims {
  exp?: number;
  iat?: number;
  user_address?: string;
}

export function decodeJwtClaims(token: string): JwtClaims | undefined {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(bytesToUtf8(base64UrlToBytes(segments[1])));
    return typeof parsed === 'object' && parsed !== null ? (parsed as JwtClaims) : undefined;
  } catch {
    return undefined;
  }
}

export function jwtExpiresAt(token: string): Date | undefined {
  const exp = decodeJwtClaims(token)?.exp;
  return typeof exp === 'number' ? new Date(exp * 1000) : undefined;
}

export function isJwtExpired(token: string, now: Date = new Date()): boolean {
  const expiresAt = jwtExpiresAt(token);
  return expiresAt !== undefined && expiresAt.getTime() <= now.getTime();
}

export class TokenStore {
  private token?: string;
  private readonly listeners = new Set<(token: string | undefined) => void>();

  set(token: string): void {
    this.token = token;
    this.notify();
  }

  get(): string | undefined {
    if (this.token !== undefined && isJwtExpired(this.token)) {
      this.clear();
      return undefined;
    }
    return this.token;
  }

  get expiresAt(): Date | undefined {
    return this.token === undefined ? undefined : jwtExpiresAt(this.token);
  }

  get isAuthenticated(): boolean {
    return this.get() !== undefined;
  }

  clear(): void {
    if (this.token === undefined) {
      return;
    }
    this.token = undefined;
    this.notify();
  }

  onChange(listener: (token: string | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.token);
    }
  }
}

export const tokenStore = new TokenStore();
