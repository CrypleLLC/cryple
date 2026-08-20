'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkIn,
  fetchSwitchRecord,
  InsufficientPrefundError,
  type HeartbeatResult,
  type HeartbeatStage,
  type SwitchRecord,
} from '@/lib/chain';
import {
  buildHeartbeatView,
  SIGNING_CAVEAT,
  UNFUNDED_DETAIL,
  type HeartbeatUrgency,
} from '@/lib/app';
import type { ReleaseStatusRecord } from '@/lib/succession';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Notice, Spinner } from './ui';

const BUSY_LABELS: Record<HeartbeatStage['name'], string> = {
  deriving: 'Checking in…',
  measuring: 'Checking in…',
  sponsoring: 'Checking in…',
  'self-funding': 'Checking in…',
  signing: 'Confirming it is you…',
  submitting: 'Sending…',
  waiting: 'Waiting for confirmation…',
};

const URGENCY_TONE: Record<HeartbeatUrgency, 'info' | 'warning' | 'danger'> = {
  idle: 'info',
  unconfigured: 'info',
  due: 'warning',
  overdue: 'warning',
  contested: 'danger',
};

export default function HeartbeatCard({
  status,
  onCheckedIn,
}: {
  status: ReleaseStatusRecord;
  onCheckedIn?: (result: HeartbeatResult) => void;
}) {
  const { session } = useAuthedContext();
  const { reportError } = useCryple();

  const [chain, setChain] = useState<SwitchRecord>();
  const [stage, setStage] = useState<HeartbeatStage>();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string>();

  const address = status.chain.smart_account_address;

  const readChain = useCallback(async () => {
    try {
      setChain(await fetchSwitchRecord(address));
    } catch {
      setChain(undefined);
    }
  }, [address]);

  useEffect(() => {
    void readChain();
  }, [readChain]);

  const view = useMemo(() => buildHeartbeatView(status, chain), [status, chain]);

  const submit = useCallback(async () => {
    setMessage(undefined);
    setConfirmed(false);
    try {
      const result = await checkIn(
        {
          privateKey: session.identityPrivateKey,
          publicKeyUncompressed: session.identityPublicKeyUncompressed,
        },
        { reportedSmartAccountAddress: address, onStage: setStage },
      );
      setConfirmed(true);
      await readChain();
      onCheckedIn?.(result);
    } catch (cause) {
      setMessage(
        cause instanceof InsufficientPrefundError ? UNFUNDED_DETAIL : reportError(cause),
      );
    } finally {
      setStage(undefined);
    }
  }, [session, address, readChain, onCheckedIn, reportError]);

  const busy = stage !== undefined;

  return (
    <Card title="Your switch">
      <div className="space-y-4">
        <Notice tone={URGENCY_TONE[view.urgency]}>{view.headline}</Notice>

        {view.lastCheckIn ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Last checked in {view.lastCheckIn.toLocaleDateString()}
            {view.dueAt ? ` · next one due by ${view.dueAt.toLocaleDateString()}` : ''}
          </p>
        ) : null}

        {busy ? (
          <div>
            <Spinner />
            <p className="text-center text-sm text-slate-500">{BUSY_LABELS[stage.name]}</p>
          </div>
        ) : (
          <Button disabled={busy} onClick={() => void submit()}>
            {view.actionLabel}
          </Button>
        )}

        {confirmed && !busy ? <Notice tone="success">You are checked in.</Notice> : null}
        {message ? <Notice tone="danger">{message}</Notice> : null}

        <p className="text-xs text-slate-500">{SIGNING_CAVEAT}</p>
      </div>
    </Card>
  );
}
