'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assignSelection,
  candidateKey,
  describeSaveOutcome,
  groupByType,
  isPartialFailure,
  itemsToAssign,
  loadInheritanceCandidates,
  selectableKeys,
  sharedItemIds,
  toInheritableItem,
  HEIR_ACCOUNT_CLOSED,
  UNCHECKED_IS_NOT_REMOVAL,
  type CandidateGroup,
  type InheritanceCandidate,
} from '@/lib/app';
import {
  assignShare,
  listShares,
  recipientFor,
  type Beneficiary,
  type InheritanceShare,
} from '@/lib/succession';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Modal, Notice, Spinner } from './ui';

export default function SetInheritanceModal({
  beneficiary,
  onClose,
  onSaved,
}: {
  beneficiary: Beneficiary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [candidates, setCandidates] = useState<InheritanceCandidate[]>();
  const [held, setHeld] = useState<InheritanceShare[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [items, shares] = await Promise.all([
        loadInheritanceCandidates(context),
        listShares(context, beneficiary.id),
      ]);
      setCandidates(items);
      setHeld(shares);
    } catch (error) {
      setMessage(reportError(error));
      setCandidates([]);
    }
  }, [context, beneficiary.id, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupByType(candidates ?? []), [candidates]);
  const alreadyShared = useMemo(() => sharedItemIds(held), [held]);

  const chosen = useMemo(
    () => itemsToAssign(candidates ?? [], checked, held),
    [candidates, checked, held],
  );

  function toggle(key: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  function toggleGroup(group: CandidateGroup) {
    const keys = selectableKeys(group.items).filter((key) => !alreadyShared.has(idOf(key)));

    setChecked((current) => {
      const next = new Set(current);
      const allOn = keys.every((key) => next.has(key));
      keys.forEach((key) => (allOn ? next.delete(key) : next.add(key)));
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMessage(undefined);

    try {
      const recipient = recipientFor(beneficiary);
      const outcome = await assignSelection(chosen, (item) =>
        assignShare(context, beneficiary, recipient, toInheritableItem(item)),
      );

      setFailed(isPartialFailure(outcome));
      setMessage(describeSaveOutcome(outcome));

      if (outcome.saved.length > 0) {
        onSaved();
      }
      if (!isPartialFailure(outcome)) {
        onClose();

        return;
      }

      // Re-read, then leave exactly the failures ticked. The ones that landed
      // come back marked already shared; the ones that did not are still chosen,
      // so retrying is one click rather than finding them again in the list.
      await load();
      setChecked(new Set(outcome.failed.map((entry) => candidateKey(entry.candidate))));
    } catch (error) {
      setFailed(true);
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  // The Succession screen hides the button for a closed account; this refuses
  // even if some future caller does not, because everything below assumes there
  // is a live key snapshot to wrap against.
  if (beneficiary.keys_rotated) {
    return (
      <Modal title="This heir is gone" onClose={onClose}>
        <Notice tone="warning">{HEIR_ACCOUNT_CLOSED}</Notice>
      </Modal>
    );
  }

  return (
    <Modal
      title={`What ${beneficiary.username} inherits`}
      subtitle="Tick what you want to leave them. Nothing here is shared until you save."
      onClose={onClose}
      footer={
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{UNCHECKED_IS_NOT_REMOVAL}</p>
          <div className="flex items-center gap-3">
            <Button disabled={busy || chosen.length === 0} onClick={() => void save()}>
              {chosen.length === 0 ? 'Add to inheritance' : `Add ${chosen.length}`}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {message ? <Notice tone={failed ? 'danger' : 'success'}>{message}</Notice> : null}

        {candidates === undefined ? (
          <Spinner />
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Your vault is empty, so there is nothing to leave anyone yet.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.type}>
              <header className="flex items-baseline justify-between gap-4 border-b border-slate-200 pb-2 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {group.label}{' '}
                  <span className="font-normal text-slate-500">({group.items.length})</span>
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleGroup(group)}
                  className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
                >
                  Select all
                </button>
              </header>

              <ul className="divide-y divide-slate-100 dark:divide-slate-900">
                {group.items.map((item) => {
                  const key = candidateKey(item);
                  const shared = alreadyShared.has(item.id);

                  return (
                    <li key={key}>
                      <label
                        className={`flex items-center gap-3 py-2.5 ${
                          item.assignable && !shared ? 'cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(key)}
                          disabled={busy || !item.assignable || shared}
                          onChange={() => toggle(key)}
                          className="h-4 w-4 shrink-0 accent-brand-500"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm ${
                              item.assignable
                                ? 'text-slate-900 dark:text-slate-100'
                                : 'text-slate-400 dark:text-slate-600'
                            }`}
                          >
                            {item.title}
                          </span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {new Date(item.updatedAt).toLocaleDateString()}
                            {shared ? ' · already shared' : ''}
                            {item.assignable ? '' : ' · this device cannot open it'}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </Modal>
  );
}

function idOf(key: string): string {
  return key.slice(key.indexOf('|') + 1);
}
