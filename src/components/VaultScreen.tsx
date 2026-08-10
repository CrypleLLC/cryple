'use client';

import { useCallback, useEffect, useState } from 'react';
import { createSecret, deleteSecret, getSecret, listSecretsMeta, openSecret } from '@/lib/secrets';
import {
  buildVaultIndex,
  decodeSecretPayload,
  encodeSecretPayload,
  formatBytes,
  type SecretPayload,
  type VaultEntry,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, CopyButton, Empty, Field, Notice, Spinner } from './ui';

export default function VaultScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [entries, setEntries] = useState<VaultEntry[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  const [opened, setOpened] = useState<Record<string, SecretPayload>>({});
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [revealingId, setRevealingId] = useState<string>();

  const load = useCallback(async () => {
    try {
      setEntries(buildVaultIndex(await listSecretsMeta(context)));
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
      setEntries([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addSecret() {
    setBusy(true);
    try {
      await createSecret(context, encodeSecretPayload({ name: name.trim(), value }));
      setName('');
      setValue('');
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleReveal(id: string) {
    if (opened[id] !== undefined) {
      setVisible((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      return;
    }

    setRevealingId(id);
    try {
      const record = await getSecret(context, id);
      const payload = decodeSecretPayload(await openSecret(context, record));
      setOpened((current) => ({ ...current, [id]: payload }));
      setVisible((current) => new Set(current).add(id));
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setRevealingId(undefined);
    }
  }

  async function removeSecret(id: string) {
    setBusy(true);
    try {
      await deleteSecret(context, id);
      setOpened((current) => {
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
      setVisible((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Vault" subtitle="Everything stored under your account.">
        {message ? <Notice tone="danger">{message}</Notice> : null}

        {entries === undefined ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <Empty>Nothing stored yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Value</th>
                  <th className="py-2 pr-4 font-medium">Updated</th>
                  <th className="py-2 pr-0 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {entries.map((entry) => {
                  const payload = opened[entry.id];
                  const isVisible = visible.has(entry.id);
                  const isRevealing = revealingId === entry.id;

                  return (
                    <tr key={entry.id}>
                      <td className="max-w-[16rem] truncate py-3 pr-4 font-mono text-xs text-slate-900 dark:text-slate-100">
                        {isVisible && payload ? payload.name : '••••••••'}
                      </td>
                      <td className="max-w-[16rem] truncate py-3 pr-4 font-mono text-xs text-slate-900 dark:text-slate-100">
                        {isVisible && payload ? payload.value : '••••••••'}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-xs text-slate-500">
                        {new Date(entry.updatedAt).toLocaleString()} · {formatBytes(entry.bytes)}
                      </td>
                      <td className="py-3 pr-0">
                        <div className="flex justify-end gap-2">
                          {isVisible && payload ? (
                            <CopyButton value={payload.value} label="Copy" />
                          ) : null}
                          <Button
                            variant="secondary"
                            disabled={isRevealing}
                            onClick={() => void toggleReveal(entry.id)}
                          >
                            {isRevealing ? 'Opening…' : isVisible ? 'Hide' : 'Show'}
                          </Button>
                          <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => void removeSecret(entry.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Add a secret">
        <div className="space-y-4">
          <Field
            label="Name"
            value={name}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          <Field
            label="Value"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            disabled={busy || name.trim().length === 0 || value.length === 0}
            onClick={() => void addSecret()}
          >
            Add secret
          </Button>
        </div>
      </Card>
    </div>
  );
}
