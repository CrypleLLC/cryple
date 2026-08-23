import type { RecoverySession, RecoveryVault } from '@/lib/recovery';

export const USER_SHARE_COUNT = 1;

export type SeedRecoveryStep =
  | 'request'
  | 'waiting'
  | 'reconstructing'
  | 'recovered';

export interface SeedRecoveryState {
  step: SeedRecoveryStep;
  username?: string;
  session?: RecoverySession;
  vault?: RecoveryVault;
  mnemonic?: string;
  error?: string;
}

export type SeedRecoveryEvent =
  | { type: 'started'; username: string; session: RecoverySession; vault: RecoveryVault }
  | { type: 'session-updated'; session: RecoverySession }
  | { type: 'threshold-reached'; session: RecoverySession }
  | { type: 'reconstructed'; mnemonic: string }
  | { type: 'failed'; message: string }
  | { type: 'restart' };

export const INITIAL_SEED_RECOVERY: SeedRecoveryState = { step: 'request' };

export function seedRecoveryReducer(
  state: SeedRecoveryState,
  event: SeedRecoveryEvent,
): SeedRecoveryState {
  switch (event.type) {
    case 'started':
      return {
        step: 'waiting',
        username: event.username,
        session: event.session,
        vault: event.vault,
        error: undefined,
      };

    case 'session-updated':
      return state.step === 'waiting' ? { ...state, session: event.session } : state;

    case 'threshold-reached':
      return { ...state, step: 'reconstructing', session: event.session, error: undefined };

    case 'reconstructed':
      return { ...state, step: 'recovered', mnemonic: event.mnemonic, error: undefined };

    case 'failed':
      return { ...state, step: state.step === 'request' ? 'request' : 'waiting', error: event.message };

    case 'restart':
      return { ...INITIAL_SEED_RECOVERY, username: state.username };

    default:
      return state;
  }
}

export function collectedShares(session: RecoverySession): number {
  return session.shares?.length ?? 0;
}

export function guardianShareCount(session: RecoverySession): number {
  return Math.max(session.n_shares - USER_SHARE_COUNT, 0);
}

export function guardiansCanReachThreshold(session: RecoverySession): boolean {
  return guardianShareCount(session) >= session.k_threshold;
}

export function minutesRemaining(session: RecoverySession, now: Date = new Date()): number {
  const remaining = new Date(session.expires_at).getTime() - now.getTime();
  return Math.max(Math.ceil(remaining / 60_000), 0);
}

export function describeProgress(session: RecoverySession): string {
  const collected = collectedShares(session);
  const needed = session.k_threshold;

  if (collected >= needed) {
    return 'Every share needed has arrived.';
  }
  if (collected === 0) {
    return `Waiting for ${needed} of your ${guardianShareCount(session)} guardians.`;
  }
  return `${collected} of ${needed} shares in.`;
}

export const SEED_RECOVERY_COPY = {
  entry: 'I lost my recovery phrase',

  title: 'Ask your guardians to let you back in',
  subtitle:
    'Your guardians each hold a piece of your vault. Enough of them together can rebuild your ' +
    'recovery phrase — Cryple cannot, and never could.',

  usernameLabel: 'Your Cryple username',
  usernameHint:
    'The one on your Recovery Kit. It is not your email, and not your account address.',

  kitLabel: 'Your Recovery Kit share (optional)',
  kitHint:
    'Starts with CRK1. Add it if you have it — it is a spare in case one guardian share will ' +
    'not open, and it is never a substitute for a guardian.',

  keepOpen:
    'Keep this tab open. Your guardians send their pieces to keys that exist only on this page, ' +
    'so closing it ends the session and they would have to send again.',

  expired:
    'This session ran out of time. Starting again asks your guardians for fresh pieces — the ' +
    'ones already sent cannot be reused.',

  unreachable:
    'Your vault asks for more pieces than you have guardians, so guardians alone cannot open ' +
    'it. Nothing here can complete. If you still hold your recovery phrase, sign in with it ' +
    'and set recovery up again with a lower threshold.',

  recovered:
    'Your recovery phrase is back. Write it down again before you continue — this is the only ' +
    'time it is shown, and the copy you lost is still lost.',
} as const;

export type UsernameFeedback = { ok: true; username: string } | { ok: false; message: string };

export function checkRecoveryUsername(text: string): UsernameFeedback {
  const username = text.trim().toLowerCase();

  if (username.length === 0) {
    return { ok: false, message: 'Enter the username on your Recovery Kit.' };
  }
  if (/\s/.test(username)) {
    return { ok: false, message: 'A username is one word, with no spaces.' };
  }

  return { ok: true, username };
}
