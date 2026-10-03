'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createSecret,
  deleteSecret,
  deleteSecrets,
  listDeletedSecrets,
  listSecrets,
  openSecret,
  purgeSecrets,
  restoreSecret,
} from '@/lib/secrets';
import { HOME_FOLDER_ID } from '@/lib/folders';
import {
  actionsHeader,
  buildDeletedVaultRows,
  buildVaultRows,
  encodeSecretPayload,
  MASKED_VALUE,
  purgeConfirmationTitle,
  SECRET_DELETE_CONFIRMATION,
  SECRET_NOUNS,
  SECRET_PURGE_CONFIRMATION,
  type DeletedVaultRow,
  type OpenedDeletedSecret,
  type OpenedSecret,
  type VaultRow,
} from '@/lib/app';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';
import { useVaultReveal } from './VaultReveal';
import FolderTabs, { MoveToTab, startItemDrag, useFolderTabs } from '@/components/folders/FolderTabs';
import { HistoryIcon, SharingIcon, TrashIcon, VaultIcon } from '@/components/ui/icons';
import { Button, CopyButton, Field, FloatingAddButton, HintedIconButton, SecretField } from '@/components/ui';
import { ConfirmDeleteModal, FormModal } from '@/components/modal';
import { DateTimeCell, ItemList } from '@/components/item-list';
import ShareItemDialog from '@/components/sharing/ShareItemDialog';
import { SIDE_PANEL_TRIGGER } from '@/components/shell/SidePanel';
import DeletedSecrets from './DeletedSecrets';

export default function VaultScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useZekke();
  const { revealed } = useVaultReveal();

  const [rows, setRows] = useState<VaultRow[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState<VaultRow>();
  const [showingDeleted, setShowingDeleted] = useState(false);
  const [deletedRows, setDeletedRows] = useState<DeletedVaultRow[]>();
  const [deletedError, setDeletedError] = useState<string>();
  const [confirmingPurge, setConfirmingPurge] = useState<string[]>();

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

  const loadDeleted = useCallback(async () => {
    try {
      const records = await listDeletedSecrets(context);
      const opened = await Promise.all(
        records.map(async (record): Promise<OpenedDeletedSecret> => {
          try {
            return { record, plaintext: await openSecret(context, record) };
          } catch {
            return { record };
          }
        }),
      );
      setDeletedRows(buildDeletedVaultRows(opened));
      setDeletedError(undefined);
    } catch (error) {
      setDeletedError(reportError(error));
    }
  }, [context, reportError]);

  function toggleDeleted() {
    if (showingDeleted) {
      setShowingDeleted(false);
      return;
    }
    setShowingDeleted(true);
    setDeletedRows(undefined);
    setDeletedError(undefined);
    void loadDeleted();
  }

  const hideDeleted = useCallback(() => setShowingDeleted(false), []);

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
      if (showingDeleted) {
        await loadDeleted();
      }
    },
    [context, load, loadDeleted, showingDeleted],
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
      setConfirmingDelete(undefined);
      await load();
      if (showingDeleted) {
        await loadDeleted();
      }
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function restore(row: DeletedVaultRow) {
    setBusy(true);
    try {
      await restoreSecret(context, row.id);
      await Promise.all([load(), loadDeleted()]);
    } catch (error) {
      setDeletedError(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function purge(ids: string[]) {
    setBusy(true);
    try {
      await purgeSecrets(context, ids);
      setConfirmingPurge(undefined);
      await folders.forget(ids);
      await loadDeleted();
    } catch (error) {
      setConfirmingPurge(undefined);
      setDeletedError(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <FolderTabs state={folders} nouns={SECRET_NOUNS} label="Vault tabs" deleteItems={deleteTabItems} />

      <div className="flex justify-end">
        <Button {...SIDE_PANEL_TRIGGER} variant="secondary" aria-expanded={showingDeleted} onClick={toggleDeleted}>
          <HistoryIcon className="h-4 w-4 shrink-0" />
          Recently deleted
        </Button>
      </div>

      <ItemList
        message={message}
        onDismissMessage={() => setMessage(undefined)}
        rows={visible}
        rowKey={(row) => row.id}
        onRowDragStart={
          (folders.tabs?.length ?? 0) >= 2 ? (event, row) => startItemDrag(event, [row.id]) : undefined
        }
        dragHandleLabel="Drag onto a tab to move it"
        actionsHeader={actionsHeader(
          'Copy',
          (folders.tabs?.length ?? 0) >= 2 && 'Move',
          'Share',
          fullDevice && 'Delete',
        )}
        emptyIcon={<VaultIcon className="h-6 w-6" />}
        emptyText={
          rows?.length === 0
            ? 'Nothing stored yet. Add your first secret below — it is encrypted here before it leaves this device.'
            : 'This tab is empty. Drag a secret onto its name, or add one while the tab is open.'
        }
        columns={[
          { header: 'Name', kind: 'name', width: 'min-w-[32ch] max-w-[16rem]', render: (row) => row.name },
          {
            header: 'Value',
            kind: 'secret',
            width: 'min-w-[32ch] max-w-[20rem]',
            render: (row) => (revealed && row.readable ? row.value : MASKED_VALUE),
          },
          {
            header: 'Updated',
            kind: 'meta',
            render: (row) => <DateTimeCell at={row.updatedAt} />,
          },
        ]}
        actions={(row) => (
          <>
            {row.readable ? <CopyButton value={row.value} label="Copy" iconOnly hintPlacement="above" /> : null}
            <MoveToTab
              state={folders}
              itemIds={[row.id]}
              label={`Move ${row.name} to another tab`}
              iconOnly
              hintPlacement="above"
            />
            <HintedIconButton
              hint="Share"
              aria-label={`Share ${row.name}`}
              placement="above"
              onClick={() => setSharing(row.id)}
            >
              <SharingIcon className="h-4 w-4 shrink-0" />
            </HintedIconButton>
            {fullDevice ? (
              <HintedIconButton
                hint="Delete"
                aria-label={`Delete ${row.name}`}
                placement="above"
                tone="danger"
                disabled={busy}
                onClick={() => setConfirmingDelete(row)}
              >
                <TrashIcon className="h-4 w-4 shrink-0" />
              </HintedIconButton>
            ) : null}
          </>
        )}
      />

      {confirmingDelete !== undefined ? (
        <ConfirmDeleteModal
          title="Delete this secret?"
          subtitle={confirmingDelete.name}
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          busy={busy}
          onKeep={() => setConfirmingDelete(undefined)}
          onConfirm={() => void removeSecret(confirmingDelete.id)}
        >
          {SECRET_DELETE_CONFIRMATION}
        </ConfirmDeleteModal>
      ) : null}

      {showingDeleted ? (
        <DeletedSecrets
          rows={deletedRows}
          error={deletedError}
          busy={busy}
          canPurge={fullDevice}
          onRestore={(row) => void restore(row)}
          onPurge={setConfirmingPurge}
          onClose={hideDeleted}
        />
      ) : null}

      {confirmingPurge !== undefined ? (
        <ConfirmDeleteModal
          title={purgeConfirmationTitle(confirmingPurge.length)}
          confirmLabel={busy ? 'Deleting…' : 'Delete permanently'}
          busy={busy}
          onKeep={() => setConfirmingPurge(undefined)}
          onConfirm={() => void purge(confirmingPurge)}
        >
          {SECRET_PURGE_CONFIRMATION}
        </ConfirmDeleteModal>
      ) : null}

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
