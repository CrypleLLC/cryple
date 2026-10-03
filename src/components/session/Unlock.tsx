'use client';

import { useState } from 'react';
import { UNLOCK_COPY } from '@/lib/app';
import { useZekke } from './ZekkeProvider';
import { Button, Card, Notice, Panel, PinField } from '@/components/ui';

export default function Unlock() {
  const { unlock, startOver } = useZekke();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'warning'; text: string }>();
  const [confirming, setConfirming] = useState(false);

  async function submit(typed: string) {
    setBusy(true);
    const outcome = await unlock(typed);
    setBusy(false);
    setPin('');

    if (outcome.status === 'failed') {
      setMessage({ tone: outcome.tone, text: outcome.message });
      return;
    }
    setMessage(undefined);
  }

  return (
    <Panel>
      <Card title={UNLOCK_COPY.title} subtitle={UNLOCK_COPY.subtitle}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(pin);
          }}
        >
          <PinField
            label="PIN"
            autoFocus
            value={pin}
            onChange={setPin}
            onComplete={(typed) => {
              if (!busy) {
                void submit(typed);
              }
            }}
          />

          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy || pin.length === 0}>
              {busy ? UNLOCK_COPY.submitting : UNLOCK_COPY.submit}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {UNLOCK_COPY.startOver}
            </Button>
          </div>

          {confirming ? (
            <Notice tone="warning">
              <p>{UNLOCK_COPY.startOverConfirm}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="danger" onClick={() => void startOver()}>
                  {UNLOCK_COPY.startOverSubmit}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                  {UNLOCK_COPY.stay}
                </Button>
              </div>
            </Notice>
          ) : null}
        </form>
      </Card>
    </Panel>
  );
}
