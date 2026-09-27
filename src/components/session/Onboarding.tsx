'use client';

import { useReducer, useRef, useState } from 'react';
import { generateMnemonic, type MnemonicWordCount } from '@/lib/keys';
import type { DeviceSummary } from '@/lib/account';
import {
  ENROL_STEP_COPY,
  DEVICES_COPY,
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
  describeScopes,
  type OnboardingOrigin,
  type OnboardingState,
} from '@/lib/app';
import { parseScopeList } from '@/lib/scopes';
import { useCryple } from './CrypleProvider';
import {
  Button,
  Card,
  Notice,
  Panel,
  PinField,
  TextArea,
  type PinFieldHandle,
} from '@/components/ui';
import { PIN_LENGTH } from '@/lib/pin';

export default function Onboarding() {
  const { createAccount, enrolBrowser, enterVault, notice } = useCryple();
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING);
  const [busy, setBusy] = useState(false);
  const [noAccount, setNoAccount] = useState(false);
  const [crowded, setCrowded] = useState<readonly DeviceSummary[]>();
  const [warning, setWarning] = useState<string>();

  async function finish(pin: string, paranoid: boolean, removeDeviceIds?: readonly string[]) {
    if (state.mnemonic === undefined) {
      return;
    }

    setBusy(true);
    setNoAccount(false);

    if (state.origin === 'generate') {
      const outcome = await createAccount(state.mnemonic, pin, paranoid);
      setBusy(false);
      if (outcome.status === 'failed') {
        dispatch({ type: 'failed', message: outcome.message });
        return;
      }
      setWarning(outcome.paranoidMessage);
      dispatch({ type: 'enrolled', username: outcome.username });
      return;
    }

    const outcome = await enrolBrowser(state.mnemonic, pin, {
      removeDeviceIds: removeDeviceIds ?? (state.lostDevices ? 'all' : undefined),
    });
    setBusy(false);

    switch (outcome.status) {
      case 'enrolled':
        setCrowded(undefined);
        dispatch({ type: 'enrolled', username: outcome.username });
        enterVault();
        return;
      case 'no-account':
        setNoAccount(true);
        dispatch({ type: 'failed', message: ENROL_STEP_COPY.noAccount });
        return;
      case 'too-many-devices':
        setCrowded(outcome.devices);
        dispatch({ type: 'failed', message: DEVICES_COPY.tooMany });
        return;
      case 'failed':
        dispatch({ type: 'failed', message: outcome.message });
    }
  }

  const [pendingPin, setPendingPin] = useState<string>();

  const paranoid = state.origin === 'generate' && state.paranoid === true;

  function choosePin(pin: string) {
    dispatch({ type: 'pin-chosen', pin });
    if (checkPin(pin).ok) {
      setPendingPin(pin);
      void finish(pin, paranoid);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {notice && state.step === 'origin' ? <Notice tone="warning">{notice}</Notice> : null}
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {warning ? <Notice tone="warning">{warning}</Notice> : null}

      {noAccount ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => {
              setNoAccount(false);
              dispatch({ type: 'create-instead' });
            }}
          >
            {ENROL_STEP_COPY.createInstead}
          </Button>
        </div>
      ) : null}

      {crowded !== undefined && pendingPin !== undefined ? (
        <TooManyDevices
          devices={crowded}
          busy={busy}
          onRemove={(ids) => void finish(pendingPin, false, ids)}
        />
      ) : null}

      {state.step === 'origin' ? <OriginStep dispatch={dispatch} /> : null}
      {state.step === 'mode' ? (
        <ModeStep
          initialParanoid={state.paranoid === true}
          onContinue={(chosen) => dispatch({ type: 'mode-chosen', paranoid: chosen })}
          onBack={() => dispatch({ type: 'back' })}
        />
      ) : null}
      {state.step === 'pin' ? (
        <PinStep
          busy={busy}
          signingUp={state.origin === 'generate'}
          paranoid={paranoid}
          onSubmit={choosePin}
        />
      ) : null}
      {state.step === 'enrolling' ? (
        <Panel>
          <Card title={state.origin === 'generate' ? 'Creating your vault' : ENROL_STEP_COPY.title}>
            <p className="text-compact text-ink-soft">
              Generating this browser’s keys and checking your PIN with the server. This takes a
              moment: checking a PIN is deliberately slow, so that guessing one is slow too.
            </p>
          </Card>
        </Panel>
      ) : null}
      {state.step === 'recovery-kit' ? (
        <RecoveryKitStep state={state} dispatch={dispatch} onContinue={enterVault} />
      ) : null}

      {canGoBack(state) && state.step !== 'mode' ? (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={busy} onClick={() => dispatch({ type: 'back' })}>
            Back
          </Button>
        </div>
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
  const [lostDevices, setLostDevices] = useState(false);

  const signingUp = tab === 'generate';

  function startSignUp() {
    dispatch({ type: 'choose-origin', origin: 'generate', wordCount });
    dispatch({ type: 'mnemonic-ready', mnemonic: generateMnemonic(wordCount) });
  }

  function startEnrolment() {
    const checked = checkMnemonic(phrase);
    if (!checked.ok) {
      setPhraseError(checked.message);
      return;
    }
    setPhraseError(undefined);
    dispatch({ type: 'choose-origin', origin: 'import', wordCount });
    dispatch({
      type: 'mnemonic-ready',
      mnemonic: mnemonicSentence(phrase),
      lostDevices,
    });
    setPhrase('');
  }

  return (
    <div className="space-y-6">
      <p className="text-center text-compact text-ink-muted">
        Your recovery phrase is the account. Nothing on our servers can replace it.
      </p>

      <Panel padded={false}>
        <div className="flex justify-center border-b border-line px-5">
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

        <div className="space-y-4 p-6">
          {signingUp ? (
            <>
              <p className="text-center text-compact text-balance text-ink-soft">
                We will generate a recovery phrase for you and give you a recovery kit to keep
                offline.
                <br className="hidden sm:inline" /> It is the only way back into your vault, and the
                only way to add a device.
              </p>

              <div className="mx-auto flex w-fit flex-col gap-4">
                <div className="flex gap-2">
                  {([12, 24] as const).map((count) => (
                    <Button
                      key={count}
                      className="flex-1"
                      variant={wordCount === count ? 'primary' : 'secondary'}
                      onClick={() => setWordCount(count)}
                    >
                      {count} words
                    </Button>
                  ))}
                </div>

                <Button className="w-full" onClick={startSignUp}>
                  Create my recovery phrase
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-center text-compact text-ink-soft">{ENROL_STEP_COPY.summary}</p>

              <TextArea
                label="Recovery phrase"
                rows={3}
                value={phrase}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setPhrase(event.target.value)}
              />

              <Notice tone="info">{ENROL_STEP_COPY.exposure}</Notice>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-raised p-4">
                <input
                  type="checkbox"
                  checked={lostDevices}
                  onChange={(event) => setLostDevices(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span>
                  <span className="block text-compact font-semibold text-ink">
                    {ENROL_STEP_COPY.lostDevices}
                  </span>
                  {lostDevices ? (
                    <span className="mt-1 block text-compact text-ink-muted">
                      {ENROL_STEP_COPY.lostDevicesWarning}
                    </span>
                  ) : null}
                </span>
              </label>

              {phraseError ? <Notice tone="danger">{phraseError}</Notice> : null}

              <Button className="w-full" onClick={startEnrolment}>
                Continue
              </Button>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

function TooManyDevices({
  devices,
  busy,
  onRemove,
}: {
  devices: readonly DeviceSummary[];
  busy: boolean;
  onRemove: (ids: readonly string[]) => void;
}) {
  const [chosen, setChosen] = useState<readonly string[]>([]);

  return (
    <Panel>
      <Card title={DEVICES_COPY.removeTitle} subtitle={DEVICES_COPY.tooMany}>
        <div className="space-y-4">
          <ul className="space-y-2">
            {devices.map((device) => (
              <li key={device.id}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={chosen.includes(device.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, device.id]
                          : current.filter((id) => id !== device.id),
                      )
                    }
                    className="h-4 w-4 accent-brand-500"
                  />
                  <span className="text-compact text-ink">
                    {describeScopes(parseScopeList(device.scopes))} · added{' '}
                    {new Date(device.createdAt).toLocaleDateString()}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Notice tone="warning">{DEVICES_COPY.removeWarning}</Notice>
          <Button
            variant="danger"
            disabled={busy || chosen.length === 0}
            onClick={() => onRemove(chosen)}
          >
            {busy ? DEVICES_COPY.removing : DEVICES_COPY.removeSubmit}
          </Button>
        </div>
      </Card>
    </Panel>
  );
}

function PinStep({
  busy,
  signingUp,
  paranoid,
  onSubmit,
}: {
  busy: boolean;
  signingUp: boolean;
  paranoid: boolean;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string>();
  const confirmationField = useRef<PinFieldHandle>(null);

  function submit(confirmed: string) {
    const result = checkPin(pin, confirmed);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    onSubmit(pin);
  }

  function confirm(typed: string) {
    setConfirmation(typed);
    if (typed.length < PIN_LENGTH) {
      setMessage(undefined);
    }
  }

  return (
    <Panel>
      <Card
        title={signingUp ? PIN_STEP_COPY.title : ENROL_STEP_COPY.title}
        subtitle={signingUp ? PIN_STEP_COPY.subtitle : PIN_STEP_COPY.signIn}
      >
        <div className="space-y-4">
          {paranoid ? <Notice tone="warning">{MODE_COPY.oneWayDoor}</Notice> : null}

          <div className="mx-auto w-fit max-w-full space-y-4">
            <PinField
              label="PIN"
              autoFocus
              value={pin}
              onChange={setPin}
              onComplete={() => confirmationField.current?.focus()}
            />
            <PinField
              ref={confirmationField}
              label="Confirm PIN"
              value={confirmation}
              onChange={confirm}
              onComplete={(typed) => {
                if (!busy) {
                  submit(typed);
                }
              }}
            />

            <Button className="w-full" disabled={busy} onClick={() => submit(confirmation)}>
              {busy ? 'Opening your vault…' : signingUp ? 'Create my vault' : 'Add this browser'}
            </Button>
          </div>

          {message ? <Notice tone="danger">{message}</Notice> : null}
        </div>
      </Card>
    </Panel>
  );
}

function ModeStep({
  initialParanoid,
  onContinue,
  onBack,
}: {
  initialParanoid: boolean;
  onContinue: (paranoid: boolean) => void;
  onBack: () => void;
}) {
  const [paranoid, setParanoid] = useState(initialParanoid);
  const mode = paranoid ? 'paranoid' : 'standard';

  return (
    <>
      <Panel>
        <div className="space-y-4">
          <p className="text-center text-compact font-semibold text-ink">
            How should your recovery phrase be protected?
          </p>

          <div
            role="radiogroup"
            aria-label="Protection mode"
            className="mx-auto flex w-fit rounded-full border border-line bg-raised p-1"
          >
            {(['standard', 'paranoid'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => setParanoid(option === 'paranoid')}
                className={`flex-1 rounded-full px-5 py-1.5 text-compact font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                  mode === option
                    ? 'bg-brand-600 text-white shadow-card'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {MODE_COPY[option].title}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-raised p-4">
            <p className="text-compact font-semibold text-ink">{MODE_COPY[mode].summary}</p>
            <p className="mt-1 text-compact text-ink-muted">{MODE_COPY[mode].tradeoff}</p>
          </div>

          {paranoid ? <Notice tone="warning">{MODE_COPY.oneWayDoor}</Notice> : null}
        </div>
      </Panel>

      <div className="mx-auto grid w-fit grid-cols-2 gap-2">
        <Button variant="secondary" className="w-full" onClick={onBack}>
          Back
        </Button>
        <Button className="w-full" onClick={() => onContinue(paranoid)}>
          Continue
        </Button>
      </div>
    </>
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
      const bytes = await buildRecoveryKitPdf({
        username,
        mnemonic,
        createdAt: new Date(),
      });
      offerDownload(recoveryKitFileName(username), bytes);
      dispatch({ type: 'recovery-kit-saved' });
    } catch {
      setFailed(true);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Panel>
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
            <div className="space-y-2">
              <p
                className="rounded-xl border border-line bg-raised px-4 py-3 font-mono text-sm leading-relaxed break-words text-ink select-none"
                onCopy={(event) => event.preventDefault()}
                onCut={(event) => event.preventDefault()}
                onDragStart={(event) => event.preventDefault()}
              >
                {phrase}
              </p>
              <p className="text-xs text-ink-muted">{RECOVERY_KIT_STEP_COPY.notCopyable}</p>
            </div>
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
    </Panel>
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
