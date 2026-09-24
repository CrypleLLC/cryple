'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSecret, deleteSecret, deleteSecrets, listSecrets, openSecret } from '@/lib/secrets';
import { HOME_FOLDER_ID } from '@/lib/folders';
import {
  buildVaultRows,
  encodeSecretPayload,
  formatBytes,
  MASKED_VALUE,
  SECRET_NOUNS,
  type OpenedSecret,
  type VaultRow,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { useVaultReveal } from './VaultReveal';
import FolderTabs, { MoveToTab, startItemDrag, useFolderTabs } from './FolderTabs';
import { SharingIcon, TrashIcon, VaultIcon } from './icons';
import {
  Button,
  Card,
  CopyButton,
  Empty,
  Field,
  FloatingAddButton,
  Modal,
  Notice,
  SecretField,
  Spinner,
} from './ui';
import ShareItemDialog from './ShareItemDialog';

export default function VaultScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();
  const { revealed } = useVaultReveal();

  const [rows, setRows] = useState<VaultRow[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<string>();

  const [adding, setAdding] = useState(false);
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

  const rowIds = useMemo(() => rows?.map((row) => row.id), [rows]);
  const folders = useFolderTabs('secrets', rowIds);
  const filterTab = folders.filter;
  const visible = useMemo(
    () => (rows === undefined ? undefined : filterTab(rows, (row) => row.id)),
    [rows, filterTab],
  );

  const deleteTabItems = useCallback(
    async (ids: string[]) => {
      await deleteSecrets(context, ids);
      await load();
    },
    [context, load],
  );

  function closeAdd() {
    setAdding(false);
    setName('');
    setValue('');
    setValueRevealed(false);
  }

  async function addSecret() {
    setBusy(true);
    try {
      const { secret } = await createSecret(context, encodeSecretPayload({ name: name.trim(), value }));
      if (folders.active !== HOME_FOLDER_ID) {
        await folders.file(secret.id);
      }
      closeAdd();
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
      await folders.forget([id]);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <FolderTabs state={folders} nouns={SECRET_NOUNS} label="Vault tabs" deleteItems={deleteTabItems} />

      <Card
        title="Stored items"
        subtitle="Names and values are encrypted on this device before they are stored."
      >
        {message ? (
          <div className="px-5 pt-4">
            <Notice tone="danger">{message}</Notice>
          </div>
        ) : null}

        {rows === undefined || visible === undefined ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty icon={<VaultIcon className="h-6 w-6" />}>
            Nothing stored yet. Add your first secret below — it is encrypted here before it
            leaves this device.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty icon={<VaultIcon className="h-6 w-6" />}>
            This tab is empty. Drag a secret onto its name, or add one while the tab is open.
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
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    draggable
                    onDragStart={(event) => startItemDrag(event, [row.id])}
                    className="cursor-grab transition-colors hover:bg-brand-50/40 active:cursor-grabbing"
                  >
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
                        <MoveToTab state={folders} itemIds={[row.id]} label={`Move ${row.name} to another tab`} />
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

      {adding ? (
        <Modal
          title="Add a secret"
          subtitle="The name and the value are encrypted on this device before they are stored."
          onClose={closeAdd}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={closeAdd}>
                Cancel
              </Button>
              <Button
                disabled={busy || name.trim().length === 0 || value.length === 0}
                onClick={() => void addSecret()}
              >
                Add secret
              </Button>
            </div>
          }
        >
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
          </div>
        </Modal>
      ) : null}

      <FloatingAddButton label="Add a secret" disabled={busy} onClick={() => setAdding(true)} />
    </div>
  );
}
