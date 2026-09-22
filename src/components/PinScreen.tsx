'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { changeDevicePin } from '@/lib/account';
import { deriveRootKeysFromMnemonic, zeroRootKeys } from '@/lib/keys';
import { enableParanoid, rotateAccountPin } from '@/lib/oprf';
import { rawKeySigner } from '@/lib/signing';
import { getMe } from '@/lib/users';
import {
  accountPinRefusal,
  checkMnemonic,
  checkPin,
  checkUpgrade,
  mnemonicSentence,
  SECOND_FACTOR_COPY,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Field, Notice, TextArea } from './ui';

function PinFields({
  label,
  pin,
  confirmation,
  onPin,
  onConfirmation,
}: {
  label: string;
  pin: string;
  confirmation: string;
  onPin: (value: string) => void;
  onConfirmation: (value: string) => void;
}) {
  return (
    <>
      <Field
        label={label}
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(event) => onPin(event.target.value)}
      />
      <Field
        label={`Confirm ${label.toLowerCase()}`}
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={confirmation}
        onChange={(event) => onConfirmation(event.target.value)}
      />
    </>
  );
}

function DevicePinCard() {
  const { services, reportError } = useCryple();
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string }>();

  async function change() {
    const checked = checkPin(pin, confirmation);
    if (!checked.ok) {
      setMessage({ tone: 'danger', text: checked.message });
      return;
    }
    setBusy(true);
    try {
      await changeDevicePin(services, pin);
      setPin('');
      setConfirmation('');
      setMessage({ tone: 'success', text: 'This browser’s PIN has changed.' });
    } catch (error) {
      setMessage({ tone: 'danger', text: reportError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="This browser’s PIN"
      subtitle="It unlocks this browser only. Changing it needs no recovery phrase, because this browser is already unlocked."
    >
      <div className="space-y-4">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <PinFields
          label="New PIN"
          pin={pin}
          confirmation={confirmation}
          onPin={setPin}
          onConfirmation={setConfirmation}
        />
        <Button disabled={busy} onClick={() => void change()}>
          {busy ? 'Changing it…' : 'Change this browser’s PIN'}
        </Button>
      </div>
    </Card>
  );
}

async function withRoot<T>(
  phrase: string,
  expectedAddress: string,
  run: (root: Awaited<ReturnType<typeof deriveRootKeysFromMnemonic>>) => Promise<T>,
): Promise<T | 'mismatch'> {
  const root = await deriveRootKeysFromMnemonic(mnemonicSentence(phrase));
  try {
    if (root.userAddress !== expectedAddress) {
      return 'mismatch';
    }
    return await run(root);
  } finally {
    zeroRootKeys(root);
  }
}

function EnableParanoidCard() {
  const context = useAuthedContext();
  const { refreshAccount, reportError } = useCryple();
  const [mnemonic, setMnemonic] = useState('');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function upgrade() {
    const checked = checkUpgrade(mnemonic, pin, confirmation);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const outcome = await withRoot(mnemonic, context.session.userAddress, (root) =>
        enableParanoid(context, rawKeySigner(root.signing.privateKey), root.userAddress, pin),
      );
      if (outcome === 'mismatch') {
        setMessage(SECOND_FACTOR_COPY.phraseMismatch);
        return;
      }
      setMnemonic('');
      setPin('');
      setConfirmation('');
      await refreshAccount();
    } catch (error) {
      if (error instanceof ApiError && error.isCredentialFailure) {
        const me = await getMe(context).catch(() => undefined);
        if (me?.paranoid) {
          await refreshAccount();
          return;
        }
      }
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={SECOND_FACTOR_COPY.offered.title} subtitle={SECOND_FACTOR_COPY.offered.summary}>
      <div className="space-y-4">
        <Notice tone="warning">{SECOND_FACTOR_COPY.offered.oneWayDoor}</Notice>
        {message ? <Notice tone="danger">{message}</Notice> : null}
        <TextArea
          label="Recovery phrase"
          value={mnemonic}
          autoComplete="off"
          spellCheck={false}
          hint={SECOND_FACTOR_COPY.offered.phrasePrompt}
          onChange={(event) => setMnemonic(event.target.value)}
        />
        <p className="text-compact text-ink-muted">{SECOND_FACTOR_COPY.offered.pinHint}</p>
        <PinFields
          label="Account PIN"
          pin={pin}
          confirmation={confirmation}
          onPin={setPin}
          onConfirmation={setConfirmation}
        />
        <Button disabled={busy} onClick={() => void upgrade()}>
          {busy ? SECOND_FACTOR_COPY.offered.submitting : SECOND_FACTOR_COPY.offered.submit}
        </Button>
      </div>
    </Card>
  );
}

function RotateAccountPinCard() {
  const context = useAuthedContext();
  const { reportError } = useCryple();
  const [mnemonic, setMnemonic] = useState('');
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string }>();

  async function rotate() {
    const phrase = checkMnemonic(mnemonic);
    const next = checkPin(pin, confirmation);
    if (!phrase.ok || !next.ok) {
      setMessage({ tone: 'danger', text: !phrase.ok ? phrase.message : (next as { message: string }).message });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const outcome = await withRoot(mnemonic, context.session.userAddress, (root) =>
        rotateAccountPin(context, rawKeySigner(root.signing.privateKey), root.userAddress, current, pin),
      );
      if (outcome === 'mismatch') {
        setMessage({ tone: 'danger', text: SECOND_FACTOR_COPY.phraseMismatch });
        return;
      }
      setFailures(0);
      setMnemonic('');
      setCurrent('');
      setPin('');
      setConfirmation('');
      setMessage({ tone: 'success', text: SECOND_FACTOR_COPY.rotate.done });
    } catch (error) {
      if (error instanceof ApiError && error.isCredentialFailure) {
        const count = failures + 1;
        setFailures(count);
        setMessage({ tone: 'danger', text: accountPinRefusal(count) });
      } else {
        setMessage({ tone: 'danger', text: reportError(error) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={SECOND_FACTOR_COPY.rotate.title} subtitle={SECOND_FACTOR_COPY.rotate.summary}>
      <div className="space-y-4">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <TextArea
          label="Recovery phrase"
          value={mnemonic}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setMnemonic(event.target.value)}
        />
        <Field
          label="Current account PIN"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <PinFields
          label="New account PIN"
          pin={pin}
          confirmation={confirmation}
          onPin={setPin}
          onConfirmation={setConfirmation}
        />
        <Button disabled={busy} onClick={() => void rotate()}>
          {busy ? SECOND_FACTOR_COPY.rotate.submitting : SECOND_FACTOR_COPY.rotate.submit}
        </Button>
      </div>
    </Card>
  );
}

export default function PinScreen() {
  const { paranoid, fullDevice } = useCryple();

  return (
    <div className="space-y-6">
      <DevicePinCard />
      {paranoid ? (
        <>
          <Card title={SECOND_FACTOR_COPY.enabled.title} subtitle={SECOND_FACTOR_COPY.enabled.summary}>
            <Notice tone="info">{SECOND_FACTOR_COPY.enabled.oneWayDoor}</Notice>
          </Card>
          {fullDevice ? <RotateAccountPinCard /> : null}
        </>
      ) : fullDevice ? (
        <EnableParanoidCard />
      ) : null}
    </div>
  );
}
