'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  completeRecovery,
  disposeEphemeralKeys,
  getRecoveryVault,
  pollRecoverySession,
  SessionExpiredError,
  startRecovery,
  type EphemeralSessionKeys,
} from '@/lib/recovery';
import {
  checkRecoveryUsername,
  collectedShares,
  decodeRecoveryKitShare,
  describeProgress,
  guardianShareCount,
  INITIAL_SEED_RECOVERY,
  minutesRemaining,
  SEED_RECOVERY_COPY,
  seedRecoveryReducer,
  thresholdIsReachable,
} from '@/lib/app';
import { useCryple } from './CrypleProvider';
import { Button, Card, Field, Notice, Spinner, TextArea } from './ui';

export default function SeedRecovery({
  onRecovered,
  onCancel,
}: {
  onRecovered: (mnemonic: string) => void;
  onCancel: () => void;
}) {
  const { reportError } = useCryple();
  const [state, dispatch] = useReducer(seedRecoveryReducer, INITIAL_SEED_RECOVERY);
  const [username, setUsername] = useState('');
  const [kit, setKit] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasOwnShare, setHasOwnShare] = useState(false);

  const keys = useRef<EphemeralSessionKeys | undefined>(undefined);
  const ownShare = useRef<Uint8Array | undefined>(undefined);

  useEffect(
    () => () => {
      if (keys.current !== undefined) {
        disposeEphemeralKeys(keys.current);
        keys.current = undefined;
      }
    },
    [],
  );

  async function begin() {
    const checked = checkRecoveryUsername(username);
    if (!checked.ok) {
      dispatch({ type: 'failed', message: checked.message });
      return;
    }

    setBusy(true);
    try {
      ownShare.current =
        kit.trim().length === 0 ? undefined : await decodeRecoveryKitShare(kit);
      setHasOwnShare(ownShare.current !== undefined);

      const started = await startRecovery({ username: checked.username });
      keys.current = started.keys;

      const vault = await getRecoveryVault(checked.username);
      dispatch({
        type: 'started',
        username: checked.username,
        session: started.session,
        vault,
      });
    } catch (error) {
      dispatch({ type: 'failed', message: reportError(error) });
    } finally {
      setBusy(false);
    }
  }

  const session = state.session;
  const sessionId = session?.id;
  const watching = state.step === 'waiting' && sessionId !== undefined;

  useEffect(() => {
    if (!watching || sessionId === undefined) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const settled = await pollRecoverySession(sessionId, {
          signal: controller.signal,
          ownShareCount: hasOwnShare ? 1 : 0,
          onUpdate: (updated) => dispatch({ type: 'session-updated', session: updated }),
        });
        dispatch({ type: 'threshold-reached', session: settled });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        dispatch({
          type: 'failed',
          message:
            error instanceof SessionExpiredError
              ? SEED_RECOVERY_COPY.expired
              : reportError(error),
        });
      }
    })();

    return () => controller.abort();
  }, [watching, sessionId, hasOwnShare, reportError]);

  const vault = state.vault;
  const reconstructing = state.step === 'reconstructing';

  useEffect(() => {
    if (!reconstructing || session === undefined || vault === undefined) {
      return;
    }
    const material = keys.current;
    if (material === undefined) {
      return;
    }

    let live = true;

    void (async () => {
      try {
        const mnemonic = await completeRecovery({
          session,
          keys: material,
          vault,
          ownShare: ownShare.current,
        });
        if (live) {
          dispatch({ type: 'reconstructed', mnemonic });
        }
      } catch (error) {
        if (live) {
          dispatch({ type: 'failed', message: reportError(error) });
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [reconstructing, session, vault, reportError]);

  function restart() {
    if (keys.current !== undefined) {
      disposeEphemeralKeys(keys.current);
      keys.current = undefined;
    }
    ownShare.current = undefined;
    setHasOwnShare(false);
    dispatch({ type: 'restart' });
  }

  if (state.step === 'recovered' && state.mnemonic !== undefined) {
    return (
      <Card title="You are back in">
        <div className="space-y-4">
          <Notice tone="warning">{SEED_RECOVERY_COPY.recovered}</Notice>

          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-relaxed break-words text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
            {state.mnemonic}
          </p>

          <Button onClick={() => onRecovered(state.mnemonic ?? '')}>
            I have written it down
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={SEED_RECOVERY_COPY.title} subtitle={SEED_RECOVERY_COPY.subtitle}>
      <div className="space-y-4">
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

        {state.step === 'request' ? (
          <>
            <Field
              label={SEED_RECOVERY_COPY.usernameLabel}
              value={username}
              autoComplete="off"
              spellCheck={false}
              hint={SEED_RECOVERY_COPY.usernameHint}
              onChange={(event) => setUsername(event.target.value)}
            />

            <TextArea
              label={SEED_RECOVERY_COPY.kitLabel}
              rows={2}
              value={kit}
              autoComplete="off"
              spellCheck={false}
              hint={SEED_RECOVERY_COPY.kitHint}
              onChange={(event) => setKit(event.target.value)}
            />

            <Notice tone="info">{SEED_RECOVERY_COPY.keepOpen}</Notice>

            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void begin()}>
                {busy ? 'Asking…' : 'Ask my guardians'}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={onCancel}>
                Back
              </Button>
            </div>
          </>
        ) : null}

        {session !== undefined && state.step !== 'request' ? (
          <div className="space-y-4">
            {!thresholdIsReachable(session, hasOwnShare) ? (
              <Notice tone="danger">{SEED_RECOVERY_COPY.unreachable}</Notice>
            ) : null}

            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-sm font-medium">
                {describeProgress(session, hasOwnShare)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {collectedShares(session) + (hasOwnShare ? 1 : 0)} of {session.k_threshold}{' '}
                needed · {guardianShareCount(session)} guardian
                {guardianShareCount(session) === 1 ? '' : 's'} asked ·{' '}
                {minutesRemaining(session)} minutes left
              </p>
            </div>

            {reconstructing ? <Spinner /> : null}

            <Notice tone="info">{SEED_RECOVERY_COPY.keepOpen}</Notice>

            <Button variant="secondary" onClick={restart}>
              Start again
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
