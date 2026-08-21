'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getReleaseStatus,
  listBeneficiaries,
  listReleaseVotes,
  registerBeneficiary,
  type Beneficiary,
  type ReleaseStatusRecord,
} from '@/lib/succession';
import {
  auditVotes,
  buildReleaseView,
  CHAIN_UNAVAILABLE_CAVEAT,
  CONFIGURATION_CAVEAT,
  LAST_CHECK_IN_CAVEAT,
  NO_HEIRS_YET,
  heirLabelSealer,
  type AuditedVotes,
  type ReleaseView,
} from '@/lib/app';
import { listSecrets } from '@/lib/secrets';
import { getNote, listNotesMeta } from '@/lib/notes';
import { getDocument, listDocumentsMeta } from '@/lib/documents';
import { useAuthedContext, useCryple } from './CrypleProvider';
import HeartbeatCard from './HeartbeatCard';
import HeirTabs from './HeirTabs';
import VaultProtectionCard from './VaultProtectionCard';
import { Button, Card, Empty, Field, Notice, PanelGrid, Spinner } from './ui';

export default function SuccessionScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [release, setRelease] = useState<ReleaseView>();
  const [statusRecord, setStatusRecord] = useState<ReleaseStatusRecord>();
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
      setStatusRecord(status);
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

  // Protection is a succession concept: it covers what heirs inherit, and the
  // proof exists for them. On the Vault screen it read as a property of storage.
  const sources = useMemo(
    () => ({
      listSecrets: () => listSecrets(context),
      listNotesMeta: () => listNotesMeta(context),
      getNote: (id: string) => getNote(context, id),
      listDocumentsMeta: () => listDocumentsMeta(context),
      getDocument: (id: string) => getDocument(context, id),
    }),
    [context],
  );

  async function register() {
    setBusy(true);
    try {
      const encryptedLabel = await heirLabelSealer(context.session.heirLabelKey).sealLabel(
        label.trim(),
      );
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

  return (
    <div className="space-y-6">
      {message ? <Notice tone="danger">{message}</Notice> : null}

      <VaultProtectionCard sources={sources} />

      {statusRecord ? (
        <HeartbeatCard status={statusRecord} onCheckedIn={() => void load()} />
      ) : null}

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

      {beneficiaries === undefined ? (
        <Card title="Who inherits what">
          <Spinner />
        </Card>
      ) : beneficiaries.length === 0 ? (
        <Card title="Who inherits what" subtitle="Heirs are named privately. They are never notified.">
          <Empty>{NO_HEIRS_YET}</Empty>
        </Card>
      ) : (
        <HeirTabs beneficiaries={beneficiaries} onChanged={() => void load()} />
      )}

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

        <Card title="Name an heir">
          <div className="space-y-4">
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
