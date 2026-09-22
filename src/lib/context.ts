import type { TokenStore } from '@/lib/api';
import type { SessionKeystore } from '@/lib/session';

export interface TokenContext {
  tokens: TokenStore;
  timeoutMs?: number;
}

export interface AuthedContext extends TokenContext {
  session: SessionKeystore;
  paranoid: boolean;
}

export function requireToken(context: Pick<TokenContext, 'tokens'>): string {
  const token = context.tokens.get();
  if (token === undefined) {
    throw new Error('no valid session token — sign in again');
  }
  return token;
}
