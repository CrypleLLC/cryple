'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, TokenStore, userMessageFor } from '@/lib/api';
import { signOut as dropToken } from '@/lib/auth';
import { createSeedVault, hasSeedVault, wipeSeedVault } from '@/lib/pin';
import { SessionKeystore } from '@/lib/session';
import { requestSession, serveSession } from '@/lib/session/handoff';
import type { AuthedContext } from '@/lib/context';
import type { AccountRecord } from '@/lib/users';
import {
  adoptHandoffSession,
  clearModeHint,
  enrolAccount,
  readModeHint,
  signInWithModeDetection,
  writeModeHint,
} from '@/lib/app';

export type AppPhase = 'loading' | 'onboarding' | 'locked' | 'ready';

export type UnlockOutcome =
  | { status: 'ready' }
  | { status: 'invalid-pin'; attemptsRemaining: number }
  | { status: 'wiped' }
  | { status: 'no-vault' }
  | { status: 'failed'; message: string };

interface CrypleValue {
  phase: AppPhase;
  account?: AccountRecord;
  paranoid: boolean;
  context?: AuthedContext;
  unlock(pin: string): Promise<UnlockOutcome>;
  enrol(mnemonic: string, pin: string | undefined, paranoid: boolean): Promise<UnlockOutcome>;
  refreshAccount(): Promise<void>;
  reportError(error: unknown): string;
  lock(): void;
  logOut(): void;
}

const CrypleContext = createContext<CrypleValue | undefined>(undefined);

export function useCryple(): CrypleValue {
  const value = useContext(CrypleContext);
  if (value === undefined) {
    throw new Error('useCryple must be used inside <CrypleProvider>');
  }
  return value;
}

export function useAuthedContext(): AuthedContext {
  const { context } = useCryple();
  if (context === undefined) {
    throw new Error('no unlocked session — this screen must render only in the ready phase');
  }
  return context;
}

export function CrypleProvider({ children }: { children: ReactNode }) {
  const session = useMemo(() => new SessionKeystore(), []);
  const tokens = useMemo(() => new TokenStore(), []);

  const [phase, setPhase] = useState<AppPhase>('loading');
  const [account, setAccount] = useState<AccountRecord>();

  useEffect(() => {
    let cancelled = false;

    const adopt = async () => {
      const offer = await requestSession();

      if (offer !== undefined && !cancelled) {
        try {
          const booted = await adoptHandoffSession({ session, tokens, offer, hint: readModeHint() });
          if (!cancelled) {
            setAccount(booted.account);
            setPhase('ready');
            return;
          }
        } catch {
          session.lock();
        }
      }

      if (!cancelled) {
        setPhase(hasSeedVault() ? 'locked' : 'onboarding');
      }
    };

    void adopt();
    return () => {
      cancelled = true;
    };
  }, [session, tokens]);

  useEffect(
    () =>
      serveSession(() =>
        session.isUnlocked
          ? { material: session.exportForHandoff(), token: tokens.get() }
          : undefined,
      ),
    [session, tokens],
  );

  useEffect(
    () =>
      session.onLock(() => {
        setAccount(undefined);
        setPhase(hasSeedVault() ? 'locked' : 'onboarding');
      }),
    [session],
  );

  const paranoid = account?.has_password ?? false;

  const context = useMemo<AuthedContext | undefined>(
    () => (phase === 'ready' ? { session, tokens, paranoid } : undefined),
    [phase, session, tokens, paranoid],
  );

  const unlock = useCallback(
    async (pin: string): Promise<UnlockOutcome> => {
      const opened = await session.unlock(pin);

      if (opened.status === 'invalid-pin') {
        return { status: 'invalid-pin', attemptsRemaining: opened.attemptsRemaining };
      }
      if (opened.status === 'wiped') {
        clearModeHint();
        setPhase('onboarding');
        return { status: 'wiped' };
      }
      if (opened.status === 'no-vault') {
        setPhase('onboarding');
        return { status: 'no-vault' };
      }

      try {
        const booted = await signInWithModeDetection({
          session,
          tokens,
          hint: readModeHint(),
        });
        setAccount(booted.account);
        setPhase('ready');
        return { status: 'ready' };
      } catch (error) {
        session.lock();
        return { status: 'failed', message: describe(error) };
      }
    },
    [session, tokens],
  );

  const enrol = useCallback(
    async (
      mnemonic: string,
      pin: string | undefined,
      wantParanoid: boolean,
    ): Promise<UnlockOutcome> => {
      try {
        await session.unlockWithMnemonic(mnemonic, pin);
        const booted = await enrolAccount({
          session,
          tokens,
          paranoid: wantParanoid,
        });

        if (pin !== undefined) {
          await createSeedVault(mnemonic, pin);
        }
        writeModeHint(booted.account.has_password);

        setAccount(booted.account);
        setPhase('ready');
        return { status: 'ready' };
      } catch (error) {
        session.lock();
        return { status: 'failed', message: describe(error) };
      }
    },
    [session, tokens],
  );

  const refreshAccount = useCallback(async () => {
    if (context === undefined) {
      return;
    }
    const { getMe } = await import('@/lib/users');
    setAccount(await getMe(context));
  }, [context]);

  const reportError = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        dropToken(tokens, session);
      }
      return describe(error);
    },
    [session, tokens],
  );

  const lock = useCallback(() => {
    dropToken(tokens, session);
  }, [session, tokens]);

  const logOut = useCallback(() => {
    dropToken(tokens, session);
    wipeSeedVault();
    clearModeHint();
    setPhase('onboarding');
  }, [session, tokens]);

  const value = useMemo<CrypleValue>(
    () => ({
      phase,
      account,
      paranoid,
      context,
      unlock,
      enrol,
      refreshAccount,
      reportError,
      lock,
      logOut,
    }),
    [phase, account, paranoid, context, unlock, enrol, refreshAccount, reportError, lock, logOut],
  );

  return <CrypleContext.Provider value={value}>{children}</CrypleContext.Provider>;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    return userMessageFor(error);
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'userMessage' in error &&
    typeof error.userMessage === 'string'
  ) {
    return error.userMessage;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
