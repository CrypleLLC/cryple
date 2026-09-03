'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkIn,
  fetchSwitchLimits,
  fetchSwitchRecord,
  InsufficientPrefundError,
  type HeartbeatResult,
  type HeartbeatStage,
  type SwitchLimits,
  type SwitchRecord,
} from '@/lib/chain';
import {
  buildHeartbeatView,
  DEFAULT_CONTEST_SECONDS,
  DEFAULT_INACTIVITY_SECONDS,
  describePeriods,
  formatMoment,
  nearestAllowedPeriod,
  periodFloorHint,
  periodsChanged,
  selectablePeriods,
  SIGNING_CAVEAT,
  UNFUNDED_DETAIL,
  type HeartbeatUrgency,
} from '@/lib/app';
import type { ReleaseStatusRecord } from '@/lib/succession';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Notice, Select, Spinner, type SelectChoice } from './ui';

const BUSY_LABELS: Record<HeartbeatStage['name'], string> = {
  deriving: 'Checking in…',
  measuring: 'Checking in…',
  sponsoring: 'Checking in…',
  'self-funding': 'Checking in…',
  signing: 'Confirming it is you…',
  submitting: 'Sending…',
  waiting: 'Waiting for confirmation…',
};

const TESTING_PERIODS_NOTE =
  'Short periods are for testing the release and the "I\'m alive" cancel. Saving new periods ' +
  'also counts as a check-in, so the clock restarts from now.';

function periodChoices(minimumSeconds: number): SelectChoice[] {
  return selectablePeriods(minimumSeconds).map((option) => ({
    value: String(option.seconds),
    label: option.allowed ? option.label : `${option.label} — below the on-chain minimum`,
    ...(option.allowed ? {} : { disabled: true }),
  }));
}

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
  const [limits, setLimits] = useState<SwitchLimits>();
  const [stage, setStage] = useState<HeartbeatStage>();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string>();
  const [inactivitySeconds, setInactivitySeconds] = useState(DEFAULT_INACTIVITY_SECONDS);
  const [contestSeconds, setContestSeconds] = useState(DEFAULT_CONTEST_SECONDS);

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

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const fetched = await fetchSwitchLimits();
        if (!live) {
          return;
        }
        setLimits(fetched);
        setInactivitySeconds((current) =>
          nearestAllowedPeriod(current, fetched.minInactivitySeconds),
        );
        setContestSeconds((current) =>
          nearestAllowedPeriod(current, fetched.minContestSeconds),
        );
      } catch {
        if (live) {
          setLimits(undefined);
        }
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (chain === undefined || chain.status === 'unconfigured') {
      return;
    }
    setInactivitySeconds(chain.inactivityPeriodSeconds);
    setContestSeconds(chain.contestPeriodSeconds);
  }, [chain]);

  const view = useMemo(() => buildHeartbeatView(status, chain), [status, chain]);

  const minInactivity = limits?.minInactivitySeconds ?? 0;
  const minContest = limits?.minContestSeconds ?? 0;
  const configured = chain !== undefined && chain.status !== 'unconfigured';
  const pendingPeriods = periodsChanged({ inactivitySeconds, contestSeconds }, chain);

  const submit = useCallback(
    async (reconfigure: boolean) => {
      setMessage(undefined);
      setConfirmed(false);
      try {
        const result = await checkIn(
          {
            privateKey: session.identityPrivateKey,
            publicKeyUncompressed: session.identityPublicKeyUncompressed,
          },
          {
            reportedSmartAccountAddress: address,
            onStage: setStage,
            inactivityPeriodSeconds: inactivitySeconds,
            contestPeriodSeconds: contestSeconds,
            reconfigure,
          },
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
    },
    [
      session,
      address,
      inactivitySeconds,
      contestSeconds,
      readChain,
      onCheckedIn,
      reportError,
    ],
  );

  const busy = stage !== undefined;

  return (
    <Card title="Your switch">
      <div className="space-y-4">
        <Notice tone={URGENCY_TONE[view.urgency]}>{view.headline}</Notice>

        {view.lastCheckIn ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Last checked in {formatMoment(view.lastCheckIn)}
            {view.dueAt ? ` · next one due by ${formatMoment(view.dueAt)}` : ''}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Go quiet for"
            value={String(inactivitySeconds)}
            disabled={busy}
            choices={periodChoices(minInactivity)}
            hint={periodFloorHint(minInactivity)}
            onChange={(event) => setInactivitySeconds(Number(event.target.value))}
          />
          <Select
            label="Then I have"
            value={String(contestSeconds)}
            disabled={busy}
            choices={periodChoices(minContest)}
            hint={periodFloorHint(minContest)}
            onChange={(event) => setContestSeconds(Number(event.target.value))}
          />
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400">
          {describePeriods(inactivitySeconds, contestSeconds)}
        </p>

        {busy ? (
          <div>
            <Spinner />
            <p className="text-center text-sm text-slate-500">{BUSY_LABELS[stage.name]}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void submit(false)}>
              {view.actionLabel}
            </Button>

            {configured ? (
              <Button
                variant="secondary"
                disabled={busy || !pendingPeriods}
                onClick={() => void submit(true)}
              >
                Save these periods
              </Button>
            ) : null}
          </div>
        )}

        {confirmed && !busy ? <Notice tone="success">You are checked in.</Notice> : null}
        {message ? <Notice tone="danger">{message}</Notice> : null}

        <p className="text-xs text-slate-500">{TESTING_PERIODS_NOTE}</p>
        <p className="text-xs text-slate-500">{SIGNING_CAVEAT}</p>
      </div>
    </Card>
  );
}
