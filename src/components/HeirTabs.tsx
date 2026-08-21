'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildAssignedItems,
  buildHeirTabs,
  HEIR_ACCOUNT_CLOSED,
  loadInheritanceCandidates,
  heirLabelSealer,
  nextActiveTab,
  NOTHING_ASSIGNED_YET,
  readLabel,
  removeHeirConfirmation,
  type InheritanceCandidate,
} from '@/lib/app';
import { deleteBeneficiary, deleteShare, listShares, type Beneficiary, type InheritanceShare } from '@/lib/succession';
import { useAuthedContext, useCryple } from './CrypleProvider';
import SetInheritanceModal from './SetInheritanceModal';
import { Button, Card, Empty, Notice, Spinner } from './ui';

export default function HeirTabs({
  beneficiaries,
  onChanged,
}: {
  beneficiaries: Beneficiary[];
  onChanged: () => void;
}) {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const tabs = useMemo(() => buildHeirTabs(beneficiaries), [beneficiaries]);
  const [active, setActive] = useState<string>();
  const [shares, setShares] = useState<InheritanceShare[]>();
  const [candidates, setCandidates] = useState<InheritanceCandidate[]>();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  // Follows the list rather than owning it: an heir removed elsewhere must not
  // leave this pointing at a tab that no longer exists.
  const current = nextActiveTab(tabs, active);
  useEffect(() => {
    if (current !== active) {
      setActive(current);
    }
    setConfirming(false);
  }, [current, active]);

  const heir = beneficiaries.find((beneficiary) => beneficiary.id === current);

  // The label is the owner's private note about this heir. Without reading it
  // back the field would be write-only, which is the same as not having it.
  const [note, setNote] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setNote(undefined);

    if (heir === undefined) {
      return;
    }

    void readLabel(heirLabelSealer(context.session.heirLabelKey), heir.encrypted_label).then(
      (text) => {
        if (!cancelled) {
          setNote(text);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [heir, context.session]);

  const loadShares = useCallback(async () => {
    if (heir === undefined) {
      setShares([]);

      return;
    }

    setShares(undefined);
    try {
      setShares(await listShares(context, heir.id));
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
      setShares([]);
    }
  }, [context, heir, reportError]);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  // The vault is opened once for the whole screen, not per tab: every title here
  // comes from decrypted content, and two heirs looking at the same vault should
  // not decrypt it twice.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const items = await loadInheritanceCandidates(context);
        if (!cancelled) {
          setCandidates(items);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(reportError(error));
          setCandidates([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context, reportError]);

  const rows = useMemo(
    () =>
      shares === undefined || candidates === undefined
        ? undefined
        : buildAssignedItems(shares, candidates),
    [shares, candidates],
  );

  // The server cascades: deleting the beneficiary takes their inheritance_shares
  // with it. Deleting the shares first would be a series of signed calls that
  // can half-fail, for a result the one call already guarantees.
  async function removeHeir() {
    if (heir === undefined) {
      return;
    }

    setBusy(true);
    try {
      await deleteBeneficiary(context, heir.id);
      setConfirming(false);
      setActive(undefined);
      onChanged();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(shareId: string) {
    setBusy(true);
    try {
      await deleteShare(context, shareId);
      await loadShares();
      onChanged();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Who inherits what" subtitle="Heirs are named privately. They are never notified." flush>
      {picking && heir ? (
        <SetInheritanceModal
          beneficiary={heir}
          onClose={() => setPicking(false)}
          onSaved={() => {
            void loadShares();
            onChanged();
          }}
        />
      ) : null}

      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 px-5 dark:border-slate-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={tab.id === current ? 'true' : undefined}
            onClick={() => setActive(tab.id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition ${
              tab.id === current
                ? 'border-brand-500 font-medium text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs text-slate-400">{tab.itemCount}</span>
          </button>
        ))}
      </div>

      {message ? (
        <div className="px-5 pt-4">
          <Notice tone="danger">{message}</Notice>
        </div>
      ) : null}

      {heir === undefined ? (
        <Empty>You have not named anyone yet.</Empty>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              {note ? (
                <p className="truncate text-sm text-slate-700 dark:text-slate-300">{note}</p>
              ) : null}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {heir.keys_rotated
                  ? HEIR_ACCOUNT_CLOSED
                  : 'Removing an item here takes it back from this heir alone.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {heir.keys_rotated ? null : (
                <Button variant="secondary" disabled={busy} onClick={() => setPicking(true)}>
                  Set inheritance
                </Button>
              )}
              <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
                Remove heir
              </Button>
            </div>
          </div>

          {confirming ? (
            <div className="px-5 pb-4">
              <Notice tone="warning">
                <p>{removeHeirConfirmation(heir.username, shares?.length ?? 0)}</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="danger" disabled={busy} onClick={() => void removeHeir()}>
                    Remove them
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                    Keep them
                  </Button>
                </div>
              </Notice>
            </div>
          ) : null}

          {rows === undefined ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <Empty>{NOTHING_ASSIGNED_YET}</Empty>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((row) => (
                <li
                  key={row.shareId}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p
                      className={`truncate text-sm ${
                        row.present ? '' : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {row.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {row.typeName}
                      {row.updatedAt
                        ? ` · ${new Date(row.updatedAt).toLocaleDateString()}`
                        : ''}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void removeAssignment(row.shareId)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
