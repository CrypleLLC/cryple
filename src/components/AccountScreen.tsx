'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { PhraseMismatchError, deleteAccountWithPhrase } from '@/lib/account';
import {
  ACCOUNT_COPY,
  SECOND_FACTOR_COPY,
  accountPinRefusal,
  checkMnemonic,
  mnemonicSentence,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Field, Notice, TextArea } from './ui';

export default function AccountScreen() {
  const context = useAuthedContext();
  const { paranoid, fullDevice, services, reportError, enterVault } = useCryple();
  const [mnemonic, setMnemonic] = useState('');
  const [pin, setPin] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [message, setMessage] = useState<string>();

  async function remove() {
    const checked = checkMnemonic(mnemonic);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await deleteAccountWithPhrase(services, context, {
        mnemonic: mnemonicSentence(mnemonic),
        accountPin: paranoid ? pin : undefined,
      });
      enterVault();
    } catch (error) {
      if (error instanceof PhraseMismatchError) {
        setMessage(SECOND_FACTOR_COPY.phraseMismatch);
      } else if (error instanceof ApiError && error.isCredentialFailure) {
        const count = failures + 1;
        setFailures(count);
        setMessage(paranoid ? accountPinRefusal(count) : reportError(error));
      } else {
        setMessage(reportError(error));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!fullDevice) {
    return (
      <Card title={ACCOUNT_COPY.deleteTitle}>
        <Notice tone="info">{ACCOUNT_COPY.limitedDevice}</Notice>
      </Card>
    );
  }

  return (
    <Card title={ACCOUNT_COPY.deleteTitle} subtitle={ACCOUNT_COPY.deleteSummary}>
      <div className="space-y-4">
        <Notice tone="danger">{ACCOUNT_COPY.deleteWarning}</Notice>
        {message ? <Notice tone="danger">{message}</Notice> : null}
        <TextArea
          label="Recovery phrase"
          value={mnemonic}
          autoComplete="off"
          spellCheck={false}
          hint={ACCOUNT_COPY.phraseHint}
          onChange={(event) => setMnemonic(event.target.value)}
        />
        {paranoid ? (
          <Field
            label="Account PIN"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
        ) : null}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
          />
          <span className="text-compact text-ink">{ACCOUNT_COPY.confirm}</span>
        </label>
        <Button variant="danger" disabled={busy || !confirmed} onClick={() => void remove()}>
          {busy ? ACCOUNT_COPY.deleting : ACCOUNT_COPY.deleteSubmit}
        </Button>
      </div>
    </Card>
  );
}
