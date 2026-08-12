import { AuthRejectedError, signIn, signUp } from '@/lib/auth';
import { ApiError, GENERIC_AUTH_FAILURE, isJwtExpired, type TokenStore } from '@/lib/api';
import { getMe, type AccountRecord } from '@/lib/users';
import type { SessionKeystore } from '@/lib/session';
import type { HandoffOffer } from '@/lib/session/handoff';
import { readModeHint, signInAttemptOrder, writeModeHint, type ModeHint } from './mode-hint';

export interface BootOptions {
  session: SessionKeystore;
  tokens: TokenStore;
  hint?: ModeHint;
  timeoutMs?: number;
}

export interface BootResult {
  account: AccountRecord;
  paranoid: boolean;
}

export class SignInFailedError extends Error {
  readonly userMessage = GENERIC_AUTH_FAILURE;
  readonly diagnostic: string;

  constructor(diagnostic: string) {
    super('sign-in was rejected in both modes');
    this.name = 'SignInFailedError';
    this.diagnostic = diagnostic;
  }
}

async function confirmMode(
  session: SessionKeystore,
  tokens: TokenStore,
  timeoutMs?: number,
): Promise<BootResult> {
  const account = await getMe({ session, tokens, paranoid: false, timeoutMs });
  writeModeHint(account.has_password);
  return { account, paranoid: account.has_password };
}

export async function signInWithModeDetection(options: BootOptions): Promise<BootResult> {
  const { session, tokens, timeoutMs } = options;
  const hint = options.hint ?? readModeHint();

  let lastDiagnostic = '';

  for (const paranoid of signInAttemptOrder(hint)) {
    try {
      await signIn({ session, paranoid, tokens, timeoutMs });
      return await confirmMode(session, tokens, timeoutMs);
    } catch (error) {
      if (error instanceof AuthRejectedError) {
        lastDiagnostic = error.diagnostic;
        continue;
      }
      throw error;
    }
  }

  throw new SignInFailedError(lastDiagnostic);
}

export interface AdoptOptions extends BootOptions {
  offer: HandoffOffer;
}

export async function adoptHandoffSession(options: AdoptOptions): Promise<BootResult> {
  const { session, tokens, offer, timeoutMs } = options;

  await session.adoptHandoff(offer.material);

  if (offer.token !== undefined && !isJwtExpired(offer.token)) {
    tokens.set(offer.token);
    try {
      return await confirmMode(session, tokens, timeoutMs);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'UNAUTHORIZED') {
        throw error;
      }
      tokens.clear();
    }
  }

  return signInWithModeDetection({ session, tokens, timeoutMs, hint: options.hint });
}

export interface EnrolOptions extends BootOptions {
  paranoid: boolean;
}

export interface EnrolResult extends BootResult {
  created: boolean;
}

export async function enrolAccount(options: EnrolOptions): Promise<EnrolResult> {
  const { session, tokens, paranoid, timeoutMs } = options;

  const outcome = await signUp({ session, paranoid, tokens, timeoutMs });
  const confirmed = await confirmMode(session, tokens, timeoutMs);

  return { ...confirmed, created: outcome.created };
}
