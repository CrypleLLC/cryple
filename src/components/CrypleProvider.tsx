'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  DEVICE_REMOVED,
  TokenStore,
  isJwtExpired,
  userMessageFor,
} from '@/lib/api';
import {
  ChainNotVerifiedError,
  DeviceRemovedError,
  NoAccountForPhraseError,
  TooManyDevicesError,
  completeSignUp,
  discardSignUpDraft,
  draftSignUp,
  enrolThisBrowser,
  forgetThisBrowser,
  removeThisBrowser,
  renewSignIn,
  unlockWithPin,
  type AccountServices,
  type DeviceSummary,
  type SignUpDraft,
} from '@/lib/account';
import { AuthRejectedError } from '@/lib/auth';
import { browserDeviceStore, discardAbandonedLocalStorage } from '@/lib/device/store';
import type { Scope } from '@/lib/scopes';
import { SessionKeystore } from '@/lib/session';
import { requestSession, serveSession } from '@/lib/session/handoff';
import type { AuthedContext } from '@/lib/context';
import { getMe, type AccountRecord } from '@/lib/users';
import {
  DEVICES_COPY,
  UNLOCK_COPY,
  unlockRateLimited,
  wrongPinMessage,
} from '@/lib/app';

export type AppPhase = 'loading' | 'onboarding' | 'locked' | 'ready';

export type UnlockOutcome =
  | { status: 'ready' }
  | { status: 'failed'; message: string; tone: 'danger' | 'warning' }
  | { status: 'forgotten'; message: string };

export type CreateOutcome =
  | { status: 'created'; username: string; paranoidMessage?: string }
  | { status: 'failed'; message: string };

export type EnrolOutcome =
  | { status: 'enrolled'; username: string }
  | { status: 'no-account' }
  | { status: 'too-many-devices'; devices: readonly DeviceSummary[] }
  | { status: 'failed'; message: string };

const TOKEN_RENEWAL_MARGIN_MS = 5 * 60 * 1000;

interface CrypleValue {
  phase: AppPhase;
  account?: AccountRecord;
  paranoid: boolean;
  context?: AuthedContext;
  fullDevice: boolean;
  holds(scope: Scope): boolean;
  chainProblem?: string;
  notice?: string;
  unlock(pin: string): Promise<UnlockOutcome>;
  createAccount(mnemonic: string, pin: string, paranoid: boolean): Promise<CreateOutcome>;
  enrolBrowser(
    mnemonic: string,
    pin: string,
    options: { removeDeviceIds?: readonly string[] | 'all' },
  ): Promise<EnrolOutcome>;
  enterVault(): void;
  refreshAccount(): Promise<void>;
  reportError(error: unknown): string;
  lock(): void;
  removeBrowser(): Promise<void>;
  startOver(): Promise<void>;
  services: AccountServices;
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
  const store = useMemo(() => browserDeviceStore(), []);
  const services = useMemo<AccountServices>(() => ({ session, tokens, store }), [session, tokens, store]);

  const [phase, setPhase] = useState<AppPhase>('loading');
  const [account, setAccount] = useState<AccountRecord>();
  const [chainProblem, setChainProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [scopes, setScopes] = useState<readonly Scope[]>([]);
  const draft = useRef<{ mnemonic: string; value: SignUpDraft } | undefined>(undefined);

  const settle = useCallback(async () => {
    const record = await store.read().catch(() => undefined);
    setPhase(record === undefined ? 'onboarding' : 'locked');
  }, [store]);

  const becomeReady = useCallback(async () => {
    const me = await getMe({ session, tokens, paranoid: false });
    setAccount(me);
    setScopes(session.scopes);
    setPhase('ready');
  }, [session, tokens]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      discardAbandonedLocalStorage();
      const offer = await requestSession();
      if (offer !== undefined && !cancelled) {
        try {
          session.adoptHandoff(offer.material);
          if (offer.token !== undefined && !isJwtExpired(offer.token)) {
            tokens.set(offer.token);
          } else {
            await renewSignIn(services);
          }
          if (!cancelled) {
            await becomeReady();
            return;
          }
        } catch {
          tokens.clear();
          session.lock();
        }
      }
      if (!cancelled) {
        await settle();
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [session, tokens, services, settle, becomeReady]);

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
        setScopes([]);
        void settle();
      }),
    [session, settle],
  );

  useEffect(() => {
    if (phase !== 'ready') {
      return;
    }
    const expiresAt = tokens.expiresAt;
    if (expiresAt === undefined) {
      return;
    }
    const delay = Math.max(expiresAt.getTime() - Date.now() - TOKEN_RENEWAL_MARGIN_MS, 1000);
    const timer = setTimeout(() => {
      void renewSignIn(services).catch(() => undefined);
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, tokens, services, account]);

  const paranoid = account?.paranoid ?? false;

  const context = useMemo<AuthedContext | undefined>(
    () => (phase === 'ready' ? { session, tokens, paranoid } : undefined),
    [phase, session, tokens, paranoid],
  );

  const describe = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        return userMessageFor(error, { deviceScopes: session.isUnlocked ? session.scopes : undefined });
      }
      if (error instanceof DeviceRemovedError) {
        return DEVICE_REMOVED;
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
    },
    [session],
  );

  const unlock = useCallback(
    async (pin: string): Promise<UnlockOutcome> => {
      try {
        const outcome = await unlockWithPin(services, pin);
        switch (outcome.status) {
          case 'unlocked':
            setChainProblem(
              outcome.chainProblem === undefined ? undefined : DEVICES_COPY.chainBroken,
            );
            await becomeReady();
            return { status: 'ready' };
          case 'wrong-pin':
            return {
              status: 'failed',
              tone: 'danger',
              message: wrongPinMessage(outcome.attemptsRemaining),
            };
          case 'offline':
            return { status: 'failed', tone: 'warning', message: UNLOCK_COPY.offline };
          case 'rate-limited':
            return {
              status: 'failed',
              tone: 'warning',
              message: unlockRateLimited(outcome.retryAfterSeconds),
            };
          case 'forgotten':
          case 'no-device':
            setNotice(UNLOCK_COPY.forgotten);
            setPhase('onboarding');
            return { status: 'forgotten', message: UNLOCK_COPY.forgotten };
          case 'removed':
            setNotice(UNLOCK_COPY.removed);
            setPhase('onboarding');
            return { status: 'forgotten', message: UNLOCK_COPY.removed };
        }
      } catch (error) {
        session.lock();
        return { status: 'failed', tone: 'danger', message: describe(error) };
      }
    },
    [services, session, becomeReady, describe],
  );

  const createAccount = useCallback(
    async (mnemonic: string, pin: string, wantParanoid: boolean): Promise<CreateOutcome> => {
      try {
        if (draft.current?.mnemonic !== mnemonic) {
          discardSignUpDraft(draft.current?.value);
          draft.current = { mnemonic, value: await draftSignUp(mnemonic) };
        }
        const result = await completeSignUp(services, draft.current.value, {
          pin,
          paranoid: wantParanoid,
        });
        draft.current = undefined;
        const me = await getMe({ session, tokens, paranoid: false });
        setAccount(me);
        setScopes(session.scopes);
        return {
          status: 'created',
          username: me.username,
          paranoidMessage:
            result.paranoidFailure === undefined ? undefined : describe(result.paranoidFailure),
        };
      } catch (error) {
        if (error instanceof AuthRejectedError || error instanceof ChainNotVerifiedError) {
          discardSignUpDraft(draft.current?.value);
          draft.current = undefined;
        }
        session.lock();
        return { status: 'failed', message: describe(error) };
      }
    },
    [services, session, tokens, describe],
  );

  const enrolBrowser = useCallback(
    async (
      mnemonic: string,
      pin: string,
      options: { removeDeviceIds?: readonly string[] | 'all' },
    ): Promise<EnrolOutcome> => {
      try {
        await enrolThisBrowser(services, { mnemonic, pin, removeDeviceIds: options.removeDeviceIds });
        const me = await getMe({ session, tokens, paranoid: false });
        setAccount(me);
        setScopes(session.scopes);
        return { status: 'enrolled', username: me.username };
      } catch (error) {
        session.lock();
        if (error instanceof NoAccountForPhraseError) {
          return { status: 'no-account' };
        }
        if (error instanceof TooManyDevicesError) {
          return { status: 'too-many-devices', devices: error.devices };
        }
        return { status: 'failed', message: describe(error) };
      }
    },
    [services, session, tokens, describe],
  );

  const enterVault = useCallback(() => {
    if (session.isUnlocked) {
      setPhase('ready');
      return;
    }
    void settle();
  }, [session, settle]);

  const refreshAccount = useCallback(async () => {
    if (context === undefined) {
      return;
    }
    setAccount(await getMe(context));
  }, [context]);

  const startOver = useCallback(async () => {
    await forgetThisBrowser(services).catch(() => undefined);
    setPhase('onboarding');
  }, [services]);

  const reportError = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError && error.isSessionOver && session.isUnlocked) {
        void renewSignIn(services).then(
          () => setNotice('Your session was renewed. Try that again.'),
          (renewal: unknown) => {
            if (renewal instanceof DeviceRemovedError) {
              setNotice(DEVICE_REMOVED);
              void startOver();
            }
          },
        );
      }
      return describe(error);
    },
    [session, services, describe, startOver],
  );

  const lock = useCallback(() => {
    tokens.clear();
    session.lock();
  }, [session, tokens]);

  const removeBrowser = useCallback(async () => {
    await removeThisBrowser(services);
    setPhase('onboarding');
  }, [services]);

  const holds = useCallback((scope: Scope) => scopes.includes(scope), [scopes]);
  const fullDevice = scopes.includes('admin');

  const value = useMemo<CrypleValue>(
    () => ({
      phase,
      account,
      paranoid,
      context,
      fullDevice,
      holds,
      chainProblem,
      notice,
      unlock,
      createAccount,
      enrolBrowser,
      enterVault,
      refreshAccount,
      reportError,
      lock,
      removeBrowser,
      startOver,
      services,
    }),
    [
      phase,
      account,
      paranoid,
      context,
      fullDevice,
      holds,
      chainProblem,
      notice,
      unlock,
      createAccount,
      enrolBrowser,
      enterVault,
      refreshAccount,
      reportError,
      lock,
      removeBrowser,
      startOver,
      services,
    ],
  );

  return <CrypleContext.Provider value={value}>{children}</CrypleContext.Provider>;
}
