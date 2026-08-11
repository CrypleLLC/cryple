'use client';

import { useCallback, useEffect, useState } from 'react';
import { createSecret, deleteSecret, listSecrets, openSecret } from '@/lib/secrets';
import {
  buildVaultRows,
  encodeSecretPayload,
  formatBytes,
  MASKED_VALUE,
  type OpenedSecret,
  type VaultRow,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { useVaultReveal } from './VaultReveal';
import { Button, Card, CopyButton, Empty, Field, Notice, PanelGrid, Spinner } from './ui';

export default function VaultScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();
  const { revealed } = useVaultReveal();

  const [rows, setRows] = useState<VaultRow[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  const load = useCallback(async () => {
    try {
      const records = await listSecrets(context);
      const opened = await Promise.all(
        records.map(async (record): Promise<OpenedSecret> => {
          try {
            return { record, plaintext: await openSecret(context, record) };
          } catch {
            return { record };
          }
        }),
      );

      setRows(buildVaultRows(opened));
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
      setRows([]);
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

  async function removeSecret(id: string) {
    setBusy(true);
    try {
      await deleteSecret(context, id);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Stored items" flush>
        {message ? (
          <div className="px-5 pt-4">
            <Notice tone="danger">{message}</Notice>
          </div>
        ) : null}

        {rows === undefined ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>Nothing stored yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                  <th className="py-2.5 pl-5 pr-4 font-medium">Name</th>
                  <th className="py-2.5 pr-4 font-medium">Value</th>
                  <th className="py-2.5 pr-4 font-medium">Updated</th>
                  <th className="py-2.5 pl-4 pr-5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-[16rem] truncate py-3 pl-5 pr-4 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {row.name}
                    </td>
                    <td className="max-w-[16rem] truncate py-3 pr-4 font-mono text-xs text-slate-900 dark:text-slate-100">
                      {revealed && row.readable ? row.value : MASKED_VALUE}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-xs text-slate-500">
                      {new Date(row.updatedAt).toLocaleString()} · {formatBytes(row.bytes)}
                    </td>
                    <td className="py-3 pl-4 pr-5">
                      <div className="flex justify-end gap-2">
                        {row.readable ? <CopyButton value={row.value} label="Copy" /> : null}
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => void removeSecret(row.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PanelGrid>
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
      </PanelGrid>
    </div>
  );
}
