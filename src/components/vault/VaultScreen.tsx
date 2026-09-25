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
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import { useVaultReveal } from './VaultReveal';
import FolderTabs, { MoveToTab, startItemDrag, useFolderTabs } from '@/components/folders/FolderTabs';
import { SharingIcon, TrashIcon, VaultIcon } from '@/components/ui/icons';
import { Button, CopyButton, Field, FloatingAddButton, SecretField } from '@/components/ui';
import { FormModal } from '@/components/modal';
import { ItemList } from '@/components/item-list';
import ShareItemDialog from '@/components/sharing/ShareItemDialog';

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

      <ItemList
        title="Stored items"
        subtitle="Names and values are encrypted on this device before they are stored."
        message={message}
        onDismissMessage={() => setMessage(undefined)}
        rows={visible}
        rowKey={(row) => row.id}
        onRowDragStart={(event, row) => startItemDrag(event, [row.id])}
        emptyIcon={<VaultIcon className="h-6 w-6" />}
        emptyText={
          rows?.length === 0
            ? 'Nothing stored yet. Add your first secret below — it is encrypted here before it leaves this device.'
            : 'This tab is empty. Drag a secret onto its name, or add one while the tab is open.'
        }
        columns={[
          { header: 'Name', kind: 'name', width: 'max-w-[16rem]', render: (row) => row.name },
          {
            header: 'Value',
            kind: 'secret',
            width: 'max-w-[16rem]',
            render: (row) => (revealed && row.readable ? row.value : MASKED_VALUE),
          },
          {
            header: 'Updated',
            kind: 'meta',
            render: (row) => `${new Date(row.updatedAt).toLocaleString()} · ${formatBytes(row.bytes)}`,
          },
        ]}
        actions={(row) => (
          <>
            {row.readable ? <CopyButton value={row.value} label="Copy" /> : null}
            <MoveToTab state={folders} itemIds={[row.id]} label={`Move ${row.name} to another tab`} />
            <Button variant="ghost" aria-label={`Share ${row.name}`} onClick={() => setSharing(row.id)}>
              <SharingIcon />
              Share
            </Button>
            {fullDevice ? (
              <Button variant="danger" disabled={busy} onClick={() => void removeSecret(row.id)}>
                <TrashIcon />
                Delete
              </Button>
            ) : null}
          </>
        )}
      />

      {sharing ? (
        <ShareItemDialog itemType="secret" itemId={sharing} onClose={() => setSharing(undefined)} />
      ) : null}

      {adding ? (
        <FormModal
          title="Add a secret"
          subtitle="The name and the value are encrypted on this device before they are stored."
          submitLabel="Add secret"
          canSubmit={name.trim().length > 0 && value.length > 0}
          busy={busy}
          onClose={closeAdd}
          onSubmit={() => void addSecret()}
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
        </FormModal>
      ) : null}

      <FloatingAddButton label="Add a secret" disabled={busy} onClick={() => setAdding(true)} />
    </div>
  );
}
