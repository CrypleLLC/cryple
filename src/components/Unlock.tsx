'use client';

import { useState } from 'react';
import { MAX_UNLOCK_ATTEMPTS } from '@/lib/pin';
import { useCryple } from './CrypleProvider';
import { Button, Card, Field, Notice } from './ui';

export default function Unlock() {
  const { unlock, logOut } = useCryple();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [wiped, setWiped] = useState(false);

  async function submit() {
    setBusy(true);
    const outcome = await unlock(pin);
    setBusy(false);
    setPin('');

    switch (outcome.status) {
      case 'ready':
        setMessage(undefined);
        return;
      case 'invalid-pin':
        setMessage(
          outcome.attemptsRemaining === 1
            ? 'Wrong PIN. One more wrong attempt erases the copy of your recovery phrase on this device.'
            : `Wrong PIN. ${outcome.attemptsRemaining} attempts left before this device is erased.`,
        );
        return;
      case 'wiped':
        setWiped(true);
        setMessage(undefined);
        return;
      case 'no-vault':
        setMessage(undefined);
        return;
      case 'failed':
        setMessage(outcome.message);
    }
  }

  if (wiped) {
    return (
      <Card title="This device has been erased">
        <div className="space-y-4">
          <Notice tone="danger">
            After {MAX_UNLOCK_ATTEMPTS} wrong PINs, the copy of your recovery phrase stored on this
            device was deleted. Your vault is untouched — sign in again with your recovery phrase,
            or recover it through your guardians.
          </Notice>
          <Button onClick={logOut}>Start over on this device</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Unlock" subtitle="Enter the PIN for this device.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="PIN"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />

        {message ? <Notice tone="danger">{message}</Notice> : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy || pin.length === 0}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
          <Button type="button" variant="secondary" onClick={logOut}>
            Log out of this device
          </Button>
        </div>
      </form>
    </Card>
  );
}
