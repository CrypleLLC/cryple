'use client';

import { useEffect, useRef, useState } from 'react';
import {
  cancelPairing,
  claimedDevice,
  displayFingerprint,
  getPairing,
  linkClaimedDevice,
  openPairing,
  ownerFingerprint,
  type ClaimedDevice,
} from '@/lib/pairing';
import { editAddressBook, setDeviceName } from '@/lib/sharing';
import {
  DEFAULT_EXTENSION_NAME,
  PAIRING_COPY,
  PAIRING_POLL_MS,
  endedBy,
  formatCountdown,
  secondsLeft,
  type ConnectStep,
} from '@/lib/app';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import { Button, Card, Field, Notice } from '@/components/ui';

export default function ConnectExtension({ onLinked }: { onLinked: () => void }) {
  const context = useAuthedContext();
  const { reportError, holds } = useCryple();
  const [step, setStep] = useState<ConnectStep>({ kind: 'idle' });
  const [message, setMessage] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [name, setName] = useState(DEFAULT_EXTENSION_NAME);
  const device = useRef<ClaimedDevice>(undefined);

  const pairingId = step.kind === 'waiting' || step.kind === 'comparing' ? step.id : undefined;

  useEffect(() => {
    if (pairingId === undefined) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairingId]);

  useEffect(() => {
    if (step.kind !== 'waiting') {
      return;
    }
    let live = true;
    const poll = setInterval(() => {
      void getPairing(context, step.id)
        .then((pairing) => {
          if (!live) {
            return;
          }
          const ended = endedBy(pairing.status);
          if (ended !== undefined) {
            setStep({ kind: 'ended', reason: ended });
            return;
          }
          if (pairing.status === 'claimed') {
            const claimed = claimedDevice(pairing);
            device.current = claimed;
            setStep({
              kind: 'comparing',
              id: step.id,
              code: step.code,
              expiresAt: step.expiresAt,
              fingerprint: ownerFingerprint(context, step.code, claimed),
            });
          }
        })
        .catch((error: unknown) => {
          if (live) {
            setMessage(reportError(error));
          }
        });
    }, PAIRING_POLL_MS);
    return () => {
      live = false;
      clearInterval(poll);
    };
  }, [context, reportError, step]);

  const remaining = step.kind === 'waiting' || step.kind === 'comparing' ? secondsLeft(step.expiresAt, now) : 0;

  useEffect(() => {
    if ((step.kind === 'waiting' || step.kind === 'comparing') && remaining === 0) {
      setStep({ kind: 'ended', reason: 'expired' });
    }
  }, [remaining, step.kind]);

  async function start() {
    setMessage(undefined);
    try {
      const opened = await openPairing(context);
      setNow(Date.now());
      setStep({ kind: 'waiting', id: opened.id, code: opened.code, expiresAt: opened.expires_at });
    } catch (error) {
      setMessage(reportError(error));
    }
  }

  async function cancel() {
    if (pairingId !== undefined) {
      await cancelPairing(context, pairingId).catch(() => undefined);
    }
    device.current = undefined;
    setStep({ kind: 'ended', reason: 'cancelled' });
  }

  async function refuse() {
    if (pairingId !== undefined) {
      await cancelPairing(context, pairingId).catch(() => undefined);
    }
    device.current = undefined;
    setStep({ kind: 'refused' });
  }

  async function confirm() {
    const claimed = device.current;
    if (step.kind !== 'comparing' || claimed === undefined) {
      return;
    }
    const id = step.id;
    setStep({ kind: 'linking' });
    try {
      await linkClaimedDevice(context, id, claimed);
      if (holds('sharing') && name.trim().length > 0) {
        await editAddressBook(context, setDeviceName(claimed.deviceId, name)).catch(() => undefined);
      }
      device.current = undefined;
      setStep({ kind: 'linked' });
      onLinked();
    } catch (error) {
      setMessage(reportError(error));
      setStep({ kind: 'idle' });
    }
  }

  return (
    <Card title={PAIRING_COPY.title} subtitle={PAIRING_COPY.summary}>
      <div className="space-y-4">
        {message ? (
          <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
            {message}
          </Notice>
        ) : null}

        {step.kind === 'idle' || step.kind === 'ended' || step.kind === 'refused' || step.kind === 'linked' ? (
          <>
            {step.kind === 'ended' ? (
              <Notice tone="warning" onDismiss={() => setStep({ kind: 'idle' })}>
                {step.reason === 'expired' ? PAIRING_COPY.expired : PAIRING_COPY.cancelled}
              </Notice>
            ) : null}
            {step.kind === 'refused' ? (
              <Notice tone="danger" onDismiss={() => setStep({ kind: 'idle' })}>
                {PAIRING_COPY.mismatchWarning}
              </Notice>
            ) : null}
            {step.kind === 'linked' ? (
              <Notice tone="success" onDismiss={() => setStep({ kind: 'idle' })}>
                {PAIRING_COPY.linked}
              </Notice>
            ) : null}
            <p className="text-compact text-ink-muted">{PAIRING_COPY.paranoidNote}</p>
            <Button onClick={() => void start()}>{PAIRING_COPY.start}</Button>
          </>
        ) : null}

        {step.kind === 'waiting' ? (
          <div className="space-y-3">
            <p className="text-compact font-semibold text-ink-soft">{PAIRING_COPY.codeHeading}</p>
            <p
              className="select-all font-mono text-3xl font-semibold tracking-[0.2em] text-ink"
              aria-live="polite"
            >
              {step.code}
            </p>
            <p className="text-compact text-ink-muted">
              {PAIRING_COPY.codeHint} {formatCountdown(remaining)} left.
            </p>
            <Button variant="secondary" onClick={() => void cancel()}>
              Cancel
            </Button>
          </div>
        ) : null}

        {step.kind === 'comparing' ? (
          <div className="space-y-4">
            <p className="text-compact font-semibold text-ink-soft">{PAIRING_COPY.compareHeading}</p>
            <p className="font-mono text-4xl font-semibold tracking-[0.15em] text-brand-700" aria-live="polite">
              {displayFingerprint(step.fingerprint)}
            </p>
            <p className="text-compact text-ink-muted">{PAIRING_COPY.compareHint}</p>
            {holds('sharing') ? (
              <Field
                label={PAIRING_COPY.nameLabel}
                value={name}
                maxLength={64}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void confirm()}>{PAIRING_COPY.match}</Button>
              <Button variant="danger" onClick={() => void refuse()}>
                {PAIRING_COPY.mismatch}
              </Button>
            </div>
            <p className="text-caption normal-case tracking-normal text-ink-muted">
              {formatCountdown(remaining)} left.
            </p>
          </div>
        ) : null}

        {step.kind === 'linking' ? <p className="text-compact text-ink-muted">{PAIRING_COPY.linking}</p> : null}
      </div>
    </Card>
  );
}
