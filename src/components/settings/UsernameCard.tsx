'use client';

import { useState } from 'react';
import { updateUsername } from '@/lib/users';
import { checkUsername, USERNAME_COPY } from '@/lib/app';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import { Button, Card, Field, Notice } from '@/components/ui';

export default function UsernameCard() {
  const context = useAuthedContext();
  const { account, refreshAccount, reportError } = useCryple();

  const [claim, setClaim] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function rename() {
    const checked = checkUsername(claim, account?.username);
    if (!checked.ok) {
      setNotice(undefined);
      setMessage(checked.message);
      return;
    }

    setBusy(true);
    setMessage(undefined);
    setNotice(undefined);

    try {
      await updateUsername(context, checked.username);
      await refreshAccount();
      setClaim('');
      setNotice(USERNAME_COPY.renamed(checked.username));
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={USERNAME_COPY.title} subtitle={USERNAME_COPY.summary}>
      <div className="space-y-4">
        {message ? (
          <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
            {message}
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="success" onDismiss={() => setNotice(undefined)}>
            {notice}
          </Notice>
        ) : null}

        <div>
          <p className="text-compact font-semibold text-ink-soft">Current username</p>
          <p className="mt-1 font-mono text-title text-ink">{account?.username}</p>
        </div>

        <Field
          label={USERNAME_COPY.label}
          value={claim}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          hint={USERNAME_COPY.hint}
          placeholder={account?.username}
          onChange={(event) => setClaim(event.target.value)}
        />

        <Button disabled={busy} onClick={() => void rename()}>
          {busy ? USERNAME_COPY.submitting : USERNAME_COPY.submit}
        </Button>

        <Notice tone="warning">{USERNAME_COPY.permanence}</Notice>
        <Notice tone="info">{USERNAME_COPY.oldNameStops}</Notice>
      </div>
    </Card>
  );
}
