'use client';

import { useMemo, useReducer, useState } from 'react';
import { generateMnemonic, type MnemonicWordCount } from '@/lib/keys';
import {
  buildVerificationChallenge,
  checkMnemonic,
  checkPin,
  INITIAL_ONBOARDING,
  MODE_COPY,
  mnemonicWords,
  onboardingReducer,
  SEED_WARNING,
  verifyBackup,
  type OnboardingState,
} from '@/lib/app';
import { useCryple } from './CrypleProvider';
import { Button, Card, Field, Notice } from './ui';

export default function Onboarding() {
  const { enrol } = useCryple();
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING);
  const [busy, setBusy] = useState(false);

  async function finish(paranoid: boolean) {
    dispatch({ type: 'mode-chosen', paranoid });

    if (state.mnemonic === undefined || state.pin === undefined) {
      return;
    }

    setBusy(true);
    const outcome = await enrol(state.mnemonic, state.pin, paranoid);
    setBusy(false);

    if (outcome.status !== 'ready') {
      dispatch({
        type: 'failed',
        message: outcome.status === 'failed' ? outcome.message : 'Could not create your vault.',
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      {state.step === 'origin' ? <OriginStep dispatch={dispatch} /> : null}
      {state.step === 'backup' ? <BackupStep state={state} dispatch={dispatch} /> : null}
      {state.step === 'verify' ? <VerifyStep state={state} dispatch={dispatch} /> : null}
      {state.step === 'import' ? <ImportStep dispatch={dispatch} /> : null}
      {state.step === 'pin' ? <PinStep dispatch={dispatch} /> : null}
      {state.step === 'mode' ? <ModeStep busy={busy} onChoose={finish} /> : null}
      {state.step === 'enrolling' ? (
        <Card title="Creating your vault">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Deriving your keys and enrolling them. This takes a moment — the PIN stretch is
            deliberately slow.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

type Dispatch = (event: Parameters<typeof onboardingReducer>[1]) => void;

function OriginStep({ dispatch }: { dispatch: Dispatch }) {
  const [wordCount, setWordCount] = useState<MnemonicWordCount>(12);

  return (
    <Card
      title="Set up Cryple"
      subtitle="Your recovery phrase is the account. Nothing on our servers can replace it."
    >
      <div className="space-y-4">
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

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => dispatch({ type: 'choose-origin', origin: 'generate', wordCount })}>
            Create a new vault
          </Button>
          <Button
            variant="secondary"
            onClick={() => dispatch({ type: 'choose-origin', origin: 'import', wordCount })}
          >
            I already have a recovery phrase
          </Button>
        </div>
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
  const [revealed, setRevealed] = useState(false);

  return (
    <Card title="Write down your recovery phrase">
      <div className="space-y-4">
        <Notice tone="warning">{SEED_WARNING}</Notice>

        {revealed ? (
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {mnemonicWords(mnemonic).map((word, index) => (
              <li
                key={`${index}-${word}`}
                className="rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-800"
              >
                <span className="mr-2 text-slate-400">{index + 1}</span>
                {word}
              </li>
            ))}
          </ol>
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

function ImportStep({ dispatch }: { dispatch: Dispatch }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string>();

  return (
    <Card title="Enter your recovery phrase" subtitle="12 or 24 words, separated by spaces.">
      <div className="space-y-4">
        <textarea
          className="h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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

function PinStep({ dispatch }: { dispatch: Dispatch }) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string>();

  return (
    <Card
      title="Choose a 6-digit PIN"
      subtitle="This encrypts your recovery phrase on this device. Three wrong tries erase the copy stored here."
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
        <Field
          label="Confirm PIN"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />

        {message ? <Notice tone="danger">{message}</Notice> : null}

        <Button
          onClick={() => {
            const result = checkPin(pin, confirmation);
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            setMessage(undefined);
            dispatch({ type: 'pin-chosen', pin });
          }}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}

function ModeStep({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose: (paranoid: boolean) => void;
}) {
  return (
    <Card title="How should signing in work?">
      <div className="space-y-4">
        <Notice tone="warning">{MODE_COPY.oneWayDoor}</Notice>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="font-medium">{MODE_COPY.standard.title}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {MODE_COPY.standard.summary}
            </p>
            <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => onChoose(false)}>
              Use Standard
            </Button>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="font-medium">{MODE_COPY.paranoid.title}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {MODE_COPY.paranoid.summary}
            </p>
            <Button className="mt-4" disabled={busy} onClick={() => onChoose(true)}>
              Use Paranoid
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
