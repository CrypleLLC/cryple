'use client';

import { useMemo, useReducer, useState } from 'react';
import { generateMnemonic, type MnemonicWordCount } from '@/lib/keys';
import {
  buildVerificationChallenge,
  canGoBack,
  checkMnemonic,
  checkPin,
  INITIAL_ONBOARDING,
  MODE_COPY,
  mnemonicSentence,
  onboardingReducer,
  PIN_STEP_COPY,
  SEED_WARNING,
  verifyBackup,
  type OnboardingOrigin,
  type OnboardingState,
} from '@/lib/app';
import { useCryple } from './CrypleProvider';
import { Button, Card, CopyButton, Field, Notice, TextArea } from './ui';

export default function Onboarding() {
  const { enrol } = useCryple();
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING);
  const [busy, setBusy] = useState(false);

  async function finish(paranoid: boolean, pin: string) {
    if (state.mnemonic === undefined) {
      return;
    }

    setBusy(true);
    const outcome = await enrol(state.mnemonic, pin, paranoid);
    setBusy(false);

    if (outcome.status !== 'ready') {
      dispatch({
        type: 'failed',
        message: outcome.status === 'failed' ? outcome.message : 'Could not create your vault.',
      });
    }
  }

  function choosePin(pin: string, paranoid: boolean) {
    dispatch({ type: 'pin-chosen', pin, paranoid });
    if (checkPin(pin).ok) {
      void finish(paranoid, pin);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      {state.step === 'origin' ? (
        <OriginStep dispatch={dispatch} />
      ) : null}
      {state.step === 'backup' ? <BackupStep state={state} dispatch={dispatch} /> : null}
      {state.step === 'verify' ? <VerifyStep state={state} dispatch={dispatch} /> : null}
      {state.step === 'import' ? <ImportStep state={state} dispatch={dispatch} /> : null}
      {state.step === 'pin' ? (
        <PinStep
          busy={busy}
          signingUp={state.origin === 'generate'}
          onSubmit={choosePin}
        />
      ) : null}
      {state.step === 'enrolling' ? (
        <Card title="Creating your vault">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {state.paranoid
              ? 'Deriving your keys and enrolling them. This takes a moment — the PIN stretch is deliberately slow.'
              : 'Deriving your keys and enrolling them. This takes a moment.'}
          </p>
        </Card>
      ) : null}

      {canGoBack(state) ? (
        <Button variant="secondary" disabled={busy} onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
      ) : null}
    </div>
  );
}

type Dispatch = (event: Parameters<typeof onboardingReducer>[1]) => void;

function OriginStep({ dispatch }: { dispatch: Dispatch }) {
  const [tab, setTab] = useState<OnboardingOrigin>('generate');
  const [wordCount, setWordCount] = useState<MnemonicWordCount>(12);

  const [phrase, setPhrase] = useState('');
  const [phraseError, setPhraseError] = useState<string>();

  const signingUp = tab === 'generate';

  function startSignUp() {
    dispatch({ type: 'choose-origin', origin: 'generate', wordCount });
  }

  // Sign-in takes the phrase on this same screen: a tab that only offers a
  // Continue button is a step that asks nothing.
  function startSignIn() {
    const checked = checkMnemonic(phrase);
    if (!checked.ok) {
      setPhraseError(checked.message);

      return;
    }

    setPhraseError(undefined);
    dispatch({ type: 'choose-origin', origin: 'import', wordCount });
    dispatch({ type: 'mnemonic-ready', mnemonic: mnemonicSentence(phrase) });
  }

  return (
    <Card
      subtitle="Your recovery phrase is the account. Nothing on our servers can replace it."
      flush
    >
      <div className="flex border-b border-slate-200 px-5 dark:border-slate-800">
        {(
          [
            ['generate', 'Sign up'],
            ['import', 'Sign in'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'true' : undefined}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm transition ${
              tab === id
                ? 'border-brand-500 font-medium text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-5">
        {signingUp ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              We will generate a recovery phrase for you. Write it down — it is the only way back
              into your vault.
            </p>

            <div className="flex gap-2">
              {([12, 24] as const).map((count) => (
                <Button
                  key={count}
                  variant={wordCount === count ? 'primary' : 'secondary'}
                  onClick={() => setWordCount(count)}
                >
                  {count} words
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Enter the recovery phrase you already have. Signing in on a new device works the
              same way — there is no password to recover.
            </p>

            <TextArea
              label="Recovery phrase"
              rows={3}
              value={phrase}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setPhrase(event.target.value)}
            />

            {phraseError ? <Notice tone="danger">{phraseError}</Notice> : null}
          </>
        )}

        <Button onClick={signingUp ? startSignUp : startSignIn}>
          {signingUp ? 'Create my recovery phrase' : 'Continue'}
        </Button>
      </div>
    </Card>
  );
}

function BackupStep({
  state,
  dispatch,
}: {
  state: OnboardingState;
  dispatch: Dispatch;
}) {
  const mnemonic = useMemo(
    () => state.mnemonic ?? generateMnemonic(state.wordCount),
    [state.mnemonic, state.wordCount],
  );
  const phrase = mnemonicSentence(mnemonic);
  const [revealed, setRevealed] = useState(false);

  return (
    <Card title="Write down your recovery phrase">
      <div className="space-y-4">
        <Notice tone="warning">{SEED_WARNING}</Notice>

        {revealed ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-relaxed break-words text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
              {phrase}
            </p>
            <CopyButton value={phrase} label="Copy phrase" copiedLabel="Copied to clipboard" />
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setRevealed(true)}>
            Reveal my phrase
          </Button>
        )}

        <Button
          disabled={!revealed}
          onClick={() => {
            dispatch({ type: 'mnemonic-ready', mnemonic });
            dispatch({ type: 'backup-confirmed' });
          }}
        >
          I have written it down
        </Button>
      </div>
    </Card>
  );
}

function VerifyStep({
  state,
  dispatch,
}: {
  state: OnboardingState;
  dispatch: Dispatch;
}) {
  const mnemonic = state.mnemonic ?? '';
  const indices = useMemo(() => buildVerificationChallenge(mnemonic, 3), [mnemonic]);
  const [answers, setAnswers] = useState<string[]>(() => indices.map(() => ''));
  const [wrong, setWrong] = useState(false);

  return (
    <Card title="Check your backup" subtitle="Type the words at these positions.">
      <div className="space-y-4">
        {indices.map((index, position) => (
          <Field
            key={index}
            label={`Word ${index + 1}`}
            value={answers[position]}
            autoComplete="off"
            onChange={(event) =>
              setAnswers((current) =>
                current.map((value, slot) => (slot === position ? event.target.value : value)),
              )
            }
          />
        ))}

        {wrong ? <Notice tone="danger">That does not match. Check your written copy.</Notice> : null}

        <Button
          onClick={() => {
            if (verifyBackup(mnemonic, indices, answers)) {
              setWrong(false);
              dispatch({ type: 'backup-confirmed' });
            } else {
              setWrong(true);
            }
          }}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}

function ImportStep({ state, dispatch }: { state: OnboardingState; dispatch: Dispatch }) {
  const [text, setText] = useState(state.mnemonic ?? '');
  const [message, setMessage] = useState<string>();

  return (
    <Card title="Enter your recovery phrase" subtitle="12 or 24 words, separated by spaces.">
      <div className="space-y-4">
        <TextArea
          label="Recovery phrase"
          value={text}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
        />

        {message ? <Notice tone="danger">{message}</Notice> : null}

        <Button
          onClick={() => {
            const result = checkMnemonic(text);
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            setMessage(undefined);
            dispatch({ type: 'mnemonic-ready', mnemonic: text.trim().replace(/\s+/g, ' ') });
          }}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}

function PinStep({
  busy,
  signingUp,
  onSubmit,
}: {
  busy: boolean;
  signingUp: boolean;
  onSubmit: (pin: string, paranoid: boolean) => void;
}) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [paranoid, setParanoid] = useState(false);
  const [message, setMessage] = useState<string>();

  return (
    <Card
      title={signingUp ? PIN_STEP_COPY.title : 'Your PIN'}
      subtitle={signingUp ? PIN_STEP_COPY.subtitle : PIN_STEP_COPY.signIn}
    >
      <div className="space-y-4">
        <Field
          label="PIN"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />
        {signingUp ? (
          <Field
            label="Confirm PIN"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        ) : null}

        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={paranoid}
              onChange={(event) => setParanoid(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
            />
            <span>
              <span className="block text-sm font-medium">
                {MODE_COPY.paranoid.title} mode — also require this PIN to sign in
              </span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                {paranoid ? MODE_COPY.paranoid.tradeoff : MODE_COPY.standard.tradeoff}
              </span>
            </span>
          </label>

          {signingUp && paranoid ? (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-500">
              {MODE_COPY.oneWayDoor}
            </p>
          ) : null}
        </div>

        {message ? <Notice tone="danger">{message}</Notice> : null}

        <Button
          disabled={busy}
          onClick={() => {
            const result = checkPin(pin, signingUp ? confirmation : undefined);
            if (!result.ok) {
              setMessage(result.message);

              return;
            }
            setMessage(undefined);
            onSubmit(pin, paranoid);
          }}
        >
          {busy ? 'Opening your vault…' : signingUp ? 'Create my vault' : 'Sign in'}
        </Button>
      </div>
    </Card>
  );
}
