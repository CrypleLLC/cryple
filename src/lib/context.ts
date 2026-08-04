import type { TokenStore } from '@/lib/api';
import type { SessionKeystore } from '@/lib/session';

export interface AuthedContext {
  session: SessionKeystore;
  tokens: TokenStore;
  paranoid: boolean;
  timeoutMs?: number;
}

export function requireToken(context: AuthedContext): string {
  const token = context.tokens.get();
  if (token === undefined) {
    throw new Error('no valid session token — sign in again');
  }
  return token;
}
