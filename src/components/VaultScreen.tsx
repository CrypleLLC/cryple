'use client';

import { useCallback, useEffect, useState } from 'react';
import { listSecretsMeta } from '@/lib/secrets';
import { buildVaultIndex, formatBytes, VAULT_SEALED_NOTICE, type VaultEntry } from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Card, Empty, Notice, Spinner } from './ui';

export default function VaultScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [entries, setEntries] = useState<VaultEntry[]>();
  const [message, setMessage] = useState<string>();

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

  return (
    <div className="space-y-6">
      <Notice tone="warning">{VAULT_SEALED_NOTICE}</Notice>

      <Card title="Vault" subtitle="Everything stored under your account.">
        {message ? <Notice tone="danger">{message}</Notice> : null}

        {entries === undefined ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <Empty>Nothing stored yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-slate-900 dark:text-slate-100">
                    {entry.id}
                  </p>
                  <p className="text-xs text-slate-500">
                    updated {new Date(entry.updatedAt).toLocaleString()} · {entry.version}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{formatBytes(entry.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
