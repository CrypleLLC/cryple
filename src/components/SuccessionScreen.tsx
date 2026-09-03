'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getReleaseStatus,
  listBeneficiaries,
  registerBeneficiary,
  type Beneficiary,
  type ReleaseStatusRecord,
} from '@/lib/succession';
import {
  buildReleaseView,
  CHAIN_UNAVAILABLE_CAVEAT,
  CONFIGURATION_CAVEAT,
  formatMoment,
  formatPeriod,
  LAST_CHECK_IN_CAVEAT,
  NO_HEIRS_YET,
  heirLabelSealer,
  THRESHOLD_UNCONFIGURED,
  type ReleaseView,
} from '@/lib/app';
import { listSecrets } from '@/lib/secrets';
import { getNote, listNotesMeta } from '@/lib/notes';
import { getDocument, listDocumentsMeta } from '@/lib/documents';
import { useAuthedContext, useCryple } from './CrypleProvider';
import HeartbeatCard from './HeartbeatCard';
import HeirTabs from './HeirTabs';
import VaultProtectionCard from './VaultProtectionCard';
import { Button, Card, Empty, Field, Notice, Spinner } from './ui';

export default function SuccessionScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [release, setRelease] = useState<ReleaseView>();
  const [statusRecord, setStatusRecord] = useState<ReleaseStatusRecord>();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>();
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [status, heirs] = await Promise.all([
        getReleaseStatus(context),
        listBeneficiaries(context),
      ]);

      setRelease(buildReleaseView(status));
      setStatusRecord(status);
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
            <Notice
              tone={
                release.chainStatus === 'contest' || release.chainStatus === 'released'
                  ? 'warning'
                  : 'info'
              }
            >
              {release.headline}
            </Notice>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Inactivity threshold</dt>
                <dd>
                  {release.inactivityPeriodSeconds === undefined
                    ? THRESHOLD_UNCONFIGURED
                    : formatPeriod(release.inactivityPeriodSeconds)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Contest period</dt>
                <dd>
                  {release.contestPeriodSeconds === undefined
                    ? THRESHOLD_UNCONFIGURED
                    : formatPeriod(release.contestPeriodSeconds)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Last check-in</dt>
                <dd>
                  {release.chainUnavailable
                    ? 'Unavailable'
                    : (release.lastCheckIn === undefined
                      ? THRESHOLD_UNCONFIGURED
                      : formatMoment(release.lastCheckIn))}
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
    </div>
  );
}
