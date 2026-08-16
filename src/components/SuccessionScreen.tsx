'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteBeneficiary,
  getReleaseStatus,
  listBeneficiaries,
  listReleaseVotes,
  registerBeneficiary,
  type Beneficiary,
} from '@/lib/succession';
import {
  auditVotes,
  buildBeneficiaryViews,
  buildReleaseView,
  CHAIN_UNAVAILABLE_CAVEAT,
  CONFIGURATION_CAVEAT,
  LABEL_SEALED_NOTICE,
  LAST_CHECK_IN_CAVEAT,
  unspecifiedLabelSealer,
  type AuditedVotes,
  type ReleaseView,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Empty, Field, Notice, PanelGrid, Spinner } from './ui';

export default function SuccessionScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [release, setRelease] = useState<ReleaseView>();
  const [audit, setAudit] = useState<AuditedVotes>();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>();
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [status, votes, heirs] = await Promise.all([
        getReleaseStatus(context),
        listReleaseVotes(context),
        listBeneficiaries(context),
      ]);

      setRelease(buildReleaseView(status));
      setAudit(auditVotes(votes));
      setBeneficiaries(heirs);
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
      setBeneficiaries([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function register() {
    setBusy(true);
    try {
      const encryptedLabel = await unspecifiedLabelSealer.sealLabel(label.trim());
      await registerBeneficiary(context, username.trim(), encryptedLabel);
      setUsername('');
      setLabel('');
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteBeneficiary(context, id);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  const views = buildBeneficiaryViews(beneficiaries ?? []);

  return (
    <div className="space-y-6">
      {message ? <Notice tone="danger">{message}</Notice> : null}

      <Card title="Release status">
        {release === undefined ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            <Notice tone={release.status === 'counting_down' ? 'warning' : 'info'}>
              {release.headline}
            </Notice>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Guardian votes</dt>
                <dd>
                  {release.votes} of {release.requiredVotes}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Countdown attempt</dt>
                <dd>#{release.releaseCycle}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Inactivity threshold</dt>
                <dd>{release.inactivityThresholdDays} days</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last check-in</dt>
                <dd>
                  {release.chainUnavailable
                    ? 'Unavailable'
                    : (release.lastCheckIn?.toLocaleDateString() ?? 'Not configured on-chain')}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-slate-500">{LAST_CHECK_IN_CAVEAT}</p>
            {release.chainUnavailable && (
              <p className="text-xs text-slate-500">{CHAIN_UNAVAILABLE_CAVEAT}</p>
            )}
            <p className="text-xs text-slate-500">{CONFIGURATION_CAVEAT}</p>
          </div>
        )}
      </Card>

      <PanelGrid>
        <Card
          title="Votes on record"
          subtitle="Each signature is rebuilt and checked here, not taken on the server's word."
          flush
        >
          {audit === undefined ? (
            <Spinner />
          ) : audit.votes.length === 0 ? (
            <Empty>No guardian has voted in this cycle.</Empty>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {audit.votes.map((entry) => (
                <li
                  key={`${entry.vote.guardian_username}-${entry.vote.challenge}`}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{entry.vote.guardian_username}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(entry.vote.voted_at).toLocaleString()} · cycle{' '}
                      {entry.vote.release_cycle}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      entry.valid ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {entry.valid ? 'signature verified' : 'signature did NOT verify'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Who inherits" subtitle="Heirs are named privately. They are never notified." flush>
          {beneficiaries === undefined ? (
            <Spinner />
          ) : views.length === 0 ? (
            <Empty>You have not named anyone yet.</Empty>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {views.map((view) => (
                <li key={view.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{view.username}</p>
                    <p className="text-xs text-slate-500">
                      {view.accountClosed
                        ? 'This heir closed their account. Remove them and choose another.'
                        : `${view.shareCount} item${view.shareCount === 1 ? '' : 's'} assigned`}
                    </p>
                  </div>
                  <Button variant="danger" disabled={busy} onClick={() => void remove(view.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Name an heir">
          <div className="space-y-4">
            <Notice tone="warning">{LABEL_SEALED_NOTICE}</Notice>

            <Field
              label="Their Cryple username"
              value={username}
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
            />
            <Field
              label="A private note to yourself"
              value={label}
              autoComplete="off"
              hint="Encrypted before it leaves this device. The server never sees it."
              onChange={(event) => setLabel(event.target.value)}
            />
            <Button
              disabled={busy || username.trim().length === 0 || label.trim().length === 0}
              onClick={() => void register()}
            >
              Name this heir
            </Button>
          </div>
        </Card>
      </PanelGrid>
    </div>
  );
}
