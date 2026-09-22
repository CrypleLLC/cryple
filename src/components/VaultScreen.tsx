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
import { SharingIcon, TrashIcon, VaultIcon } from './icons';
import { Button, Card, CopyButton, Empty, Field, Notice, PanelGrid, SecretField, Spinner } from './ui';
import ShareItemDialog from './ShareItemDialog';

export default function VaultScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();
  const { revealed } = useVaultReveal();

  const [rows, setRows] = useState<VaultRow[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<string>();

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [valueRevealed, setValueRevealed] = useState(false);

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
      setValueRevealed(false);
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
    <div className="space-y-8">
      <Card
        title="Stored items"
        subtitle="Names and values are encrypted on this device before they are stored."
      >
        {message ? (
          <div className="px-5 pt-4">
            <Notice tone="danger">{message}</Notice>
          </div>
        ) : null}

        {rows === undefined ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty icon={<VaultIcon className="h-6 w-6" />}>
            Nothing stored yet. Add your first secret below — it is encrypted here before it
            leaves this device.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-raised text-caption uppercase text-ink-muted">
                  <th className="py-3 pl-5 pr-4 text-left">Name</th>
                  <th className="py-3 pr-4 text-left">Value</th>
                  <th className="py-3 pr-4 text-left">Updated</th>
                  <th className="py-3 pl-4 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="max-w-[16rem] truncate py-3.5 pl-5 pr-4 text-compact font-semibold text-ink">
                      {row.name}
                    </td>
                    <td className="max-w-[16rem] truncate py-3.5 pr-4 font-mono text-compact text-ink-soft">
                      {revealed && row.readable ? row.value : MASKED_VALUE}
                    </td>
                    <td className="whitespace-nowrap py-3.5 pr-4 text-caption normal-case tracking-normal text-ink-muted">
                      {new Date(row.updatedAt).toLocaleString()} · {formatBytes(row.bytes)}
                    </td>
                    <td className="py-3.5 pl-4 pr-5">
                      <div className="flex justify-end gap-2">
                        {row.readable ? <CopyButton value={row.value} label="Copy" /> : null}
                        <Button
                          variant="ghost"
                          aria-label={`Share ${row.name}`}
                          onClick={() => setSharing(row.id)}
                        >
                          <SharingIcon />
                          Share
                        </Button>
                        {fullDevice ? (
                          <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => void removeSecret(row.id)}
                          >
                            <TrashIcon />
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {sharing ? (
        <ShareItemDialog itemType="secret" itemId={sharing} onClose={() => setSharing(undefined)} />
      ) : null}

      <PanelGrid>
        <Card title="Add a secret">
          <div className="space-y-4">
            <Field
              label="Name"
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
            <SecretField
              label="Value"
              value={value}
              onChange={setValue}
              revealed={valueRevealed}
              onRevealedChange={setValueRevealed}
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
