'use client';

import { useReducer, useState } from 'react';
import { generateMnemonic, type MnemonicWordCount } from '@/lib/keys';
import {
  canEnterVault,
  canGoBack,
  checkMnemonic,
  checkPin,
  INITIAL_ONBOARDING,
  MODE_COPY,
  mnemonicSentence,
  onboardingReducer,
  PIN_STEP_COPY,
  RECOVERY_KIT_STEP_COPY,
  type OnboardingOrigin,
  type OnboardingState,
} from '@/lib/app';
import { useCryple } from './CrypleProvider';
import { Button, Card, Field, Notice, TextArea } from './ui';

export default function Onboarding() {
  const { enrol, enterVault } = useCryple();
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING);
  const [busy, setBusy] = useState(false);

  async function finish(paranoid: boolean, pin: string) {
    if (state.mnemonic === undefined) {
      return;
    }

    setBusy(true);
    const outcome = await enrol(state.mnemonic, pin, paranoid);
    setBusy(false);

    if (outcome.status === 'failed') {
      dispatch({ type: 'failed', message: outcome.message });

      return;
    }

    dispatch({ type: 'enrolled', username: outcome.username });
    if (state.origin !== 'generate') {
      enterVault();
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
          <p className="text-compact text-ink-soft">
            {state.paranoid
              ? 'Deriving your keys and enrolling them. This takes a moment — the PIN stretch is deliberately slow.'
              : 'Deriving your keys and enrolling them. This takes a moment.'}
          </p>
        </Card>
      ) : null}
      {state.step === 'recovery-kit' ? (
        <RecoveryKitStep state={state} dispatch={dispatch} onContinue={enterVault} />
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
    dispatch({ type: 'mnemonic-ready', mnemonic: generateMnemonic(wordCount) });
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
    >
      <div className="flex border-b border-line px-5">
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
            className={`-mb-px border-b-2 px-4 py-3 text-compact font-semibold transition-colors ${
              tab === id
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-5">
        {signingUp ? (
          <>
            <p className="text-compact text-ink-soft">
              We will generate a recovery phrase for you and give you a recovery kit to keep
              offline — it is the only way back into your vault.
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
            <p className="text-compact text-ink-soft">
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

function RecoveryKitStep({
  state,
  dispatch,
  onContinue,
}: {
  state: OnboardingState;
  dispatch: Dispatch;
  onContinue: () => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const mnemonic = state.mnemonic ?? '';
  const username = state.username ?? '';
  const phrase = mnemonicSentence(mnemonic);
  const saved = state.recoveryKitSaved === true;

  async function downloadKit() {
    setPreparing(true);
    setFailed(false);

    try {
      const { buildRecoveryKitPdf, recoveryKitFileName } = await import('@/lib/recovery-kit');
      const bytes = await buildRecoveryKitPdf({ username, mnemonic, createdAt: new Date() });
      offerDownload(recoveryKitFileName(username), bytes);
      dispatch({ type: 'recovery-kit-saved' });
    } catch {
      setFailed(true);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Card title={RECOVERY_KIT_STEP_COPY.title} subtitle={RECOVERY_KIT_STEP_COPY.subtitle}>
      <div className="space-y-4">
        <Notice tone="warning">{RECOVERY_KIT_STEP_COPY.warning}</Notice>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={saved ? 'secondary' : 'primary'}
            disabled={preparing}
            onClick={() => void downloadKit()}
          >
            {preparing
              ? RECOVERY_KIT_STEP_COPY.preparing
              : saved
                ? RECOVERY_KIT_STEP_COPY.downloadAgain
                : RECOVERY_KIT_STEP_COPY.download}
          </Button>

          {revealed ? null : (
            <Button variant="secondary" onClick={() => setRevealed(true)}>
              {RECOVERY_KIT_STEP_COPY.reveal}
            </Button>
          )}
        </div>

        {revealed ? (
          <p className="rounded-xl border border-line bg-raised px-4 py-3 font-mono text-sm leading-relaxed break-words text-ink">
            {phrase}
          </p>
        ) : null}

        {failed ? <Notice tone="danger">{RECOVERY_KIT_STEP_COPY.failed}</Notice> : null}

        <Button
          variant={saved ? 'primary' : 'secondary'}
          disabled={!canEnterVault(state)}
          onClick={onContinue}
        >
          {RECOVERY_KIT_STEP_COPY.continue}
        </Button>
      </div>
    </Card>
  );
}

function offerDownload(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
  );
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
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

        <div className="rounded-xl border border-line bg-raised p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={paranoid}
              onChange={(event) => setParanoid(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
            />
            <span>
              <span className="block text-compact font-semibold text-ink">
                {MODE_COPY.paranoid.title} mode — also require this PIN to sign in
              </span>
              <span className="mt-1 block text-compact text-ink-muted">
                {paranoid ? MODE_COPY.paranoid.tradeoff : MODE_COPY.standard.tradeoff}
              </span>
            </span>
          </label>

          {signingUp && paranoid ? (
            <p className="mt-3 text-compact text-warning">
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
