'use client';

import { useState } from 'react';
import { deriveKeyTree, zeroKeyTree } from '@/lib/keys';
import { createSeedVault } from '@/lib/pin';
import { enableSecondFactor } from '@/lib/users';
import { checkUpgrade, SECOND_FACTOR_COPY, writeModeHint } from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Field, Notice } from './ui';

export default function SecurityScreen() {
  const context = useAuthedContext();
  const { paranoid, refreshAccount, reportError } = useCryple();

  const [mnemonic, setMnemonic] = useState('');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function upgrade() {
    const checked = checkUpgrade(mnemonic, pin, confirmation);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }

    setBusy(true);
    setMessage(undefined);

    const phrase = mnemonic.trim().replace(/\s+/g, ' ');
    const tree = await deriveKeyTree(phrase);
    const belongsToThisAccount = tree.userAddress === context.session.userAddress;
    zeroKeyTree(tree);

    if (!belongsToThisAccount) {
      setBusy(false);
      setMessage(SECOND_FACTOR_COPY.phraseMismatch);
      return;
    }

    try {
      await enableSecondFactor(context, pin);
      await createSeedVault(phrase, pin);
      writeModeHint(true);
      await refreshAccount();

      setMnemonic('');
      setPin('');
      setConfirmation('');
      setNotice(SECOND_FACTOR_COPY.enabledNotice);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  if (paranoid) {
    return (
      <Card
        title={SECOND_FACTOR_COPY.enabled.title}
        subtitle={SECOND_FACTOR_COPY.enabled.summary}
      >
        <div className="space-y-4">
          {notice ? <Notice tone="success">{notice}</Notice> : null}
          <Notice tone="info">{SECOND_FACTOR_COPY.enabled.oneWayDoor}</Notice>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={SECOND_FACTOR_COPY.offered.title}
      subtitle={SECOND_FACTOR_COPY.offered.summary}
    >
      <div className="space-y-4">
        {message ? <Notice tone="danger">{message}</Notice> : null}
        <Notice tone="warning">{SECOND_FACTOR_COPY.offered.oneWayDoor}</Notice>

        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Recovery phrase
          </span>
          <textarea
            className="mt-1 h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            value={mnemonic}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setMnemonic(event.target.value)}
          />
          <span className="mt-1 block text-xs text-slate-500">
            {SECOND_FACTOR_COPY.offered.phrasePrompt}
          </span>
        </label>

        <Field
          label="New PIN"
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

        <Button disabled={busy} onClick={() => void upgrade()}>
          {busy ? 'Turning it on…' : 'Turn on PIN protection'}
        </Button>
      </div>
    </Card>
  );
}
