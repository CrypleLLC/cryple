'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteCredential,
  deletedCredentials,
  listCredentials,
  openCredential,
  purgeDeletedCredential,
  restoreCredential,
  syncAllRevisions,
  writeCredential,
} from '@/lib/credentials';
import {
  actionsHeader,
  buildPasswordRows,
  decodeCredentialPayload,
  MASKED_PASSWORD,
  PASSWORD_PURGE_CONFIRMATION,
  passwordPurgeConfirmationTitle,
  siteLabel,
  type OpenedCredential,
  type PasswordRow,
} from '@/lib/app';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';
import { useVaultReveal } from '@/components/vault/VaultReveal';
import { HistoryIcon, PasswordsIcon, PencilIcon, TrashIcon } from '@/components/ui/icons';
import { Button, CopyButton, FloatingAddButton, HintedIconButton } from '@/components/ui';
import { ConfirmDeleteModal } from '@/components/modal';
import { DateTimeCell, ItemList } from '@/components/item-list';
import { SIDE_PANEL_TRIGGER } from '@/components/shell/SidePanel';
import DeletedPasswords, { type DeletedPasswordRow } from './DeletedPasswords';
import PasswordFormModal from './PasswordFormModal';

interface OpenForm {
  editing?: PasswordRow;
}

export default function PasswordsScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useZekke();
  const { revealed } = useVaultReveal();

  const [rows, setRows] = useState<PasswordRow[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<OpenForm>();
  const [confirmingDelete, setConfirmingDelete] = useState<PasswordRow>();
  const [deletedRows, setDeletedRows] = useState<DeletedPasswordRow[]>();
  const [deletedError, setDeletedError] = useState<string>();
  const [showingDeleted, setShowingDeleted] = useState(false);
  const [confirmingPurge, setConfirmingPurge] = useState<DeletedPasswordRow[]>();

  const load = useCallback(async () => {
    try {
      const records = await listCredentials(context);
      const opened = await Promise.all(
        records.map(async (record): Promise<OpenedCredential> => {
          try {
            return { record, plaintext: await openCredential(context, record) };
          } catch {
            return { record };
          }
        }),
      );

      setRows(buildPasswordRows(opened));
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
      const found = deletedCredentials(await syncAllRevisions(context));
      const opened = await Promise.all(
        found.map(async (deleted): Promise<DeletedPasswordRow> => {
          try {
            const payload = decodeCredentialPayload(await openCredential(context, deleted.lastLive));
            return { deleted, site: payload.site, username: payload.username };
          } catch {
            return { deleted, site: 'Unreadable credential', username: '' };
          }
        }),
      );
      setDeletedRows(opened);
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

  async function restore(row: DeletedPasswordRow) {
    setBusy(true);
    try {
      await restoreCredential(context, row.deleted);
      await Promise.all([load(), loadDeleted()]);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function purge(chosen: readonly DeletedPasswordRow[]) {
    setBusy(true);
    try {
      for (const row of chosen) {
        await purgeDeletedCredential(context, row.deleted);
      }
      setConfirmingPurge(undefined);
      await loadDeleted();
    } catch (error) {
      setConfirmingPurge(undefined);
      setDeletedError(reportError(error));
      await loadDeleted();
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential(encodedPayload: string) {
    const credentialId = form?.editing?.id;
    setBusy(true);
    try {
      await writeCredential(context, encodedPayload, credentialId === undefined ? {} : { credentialId });
      setForm(undefined);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeCredential(id: string) {
    setBusy(true);
    try {
      await deleteCredential(context, id);
      setConfirmingDelete(undefined);
      if (form?.editing?.id === id) {
        setForm(undefined);
      }
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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button {...SIDE_PANEL_TRIGGER} variant="secondary" aria-expanded={showingDeleted} onClick={toggleDeleted}>
          <HistoryIcon className="h-4 w-4 shrink-0" />
          Recently deleted
        </Button>
      </div>

      <ItemList
        message={message}
        onDismissMessage={() => setMessage(undefined)}
        rows={rows}
        rowKey={(row) => row.id}
        actionsHeader={actionsHeader('Copy', 'Edit', 'Delete')}
        emptyIcon={<PasswordsIcon className="h-6 w-6" />}
        emptyText="No passwords saved yet. Add your first one below — the server never sees the site you saved it for."
        columns={[
          {
            header: 'Site',
            kind: 'name',
            width: 'min-w-[32ch] max-w-[16rem]',
            render: (row) => (row.readable ? siteLabel(row.site) : row.site),
          },
          { header: 'Username', kind: 'text', width: 'max-w-[12rem]', render: (row) => row.username },
          {
            header: 'Password',
            kind: 'secret',
            width: 'min-w-[32ch] max-w-[20rem]',
            render: (row) => (revealed && row.readable ? row.password : MASKED_PASSWORD),
          },
          { header: 'Changed', kind: 'meta', render: (row) => <DateTimeCell at={row.changedAt} /> },
        ]}
        actions={(row) => (
          <>
            {row.readable ? <CopyButton value={row.password} label="Copy" iconOnly hintPlacement="above" /> : null}
            {row.readable ? (
              <HintedIconButton
                hint="Edit"
                aria-label={`Edit ${siteLabel(row.site)}`}
                placement="above"
                onClick={() => setForm({ editing: row })}
              >
                <PencilIcon className="h-4 w-4 shrink-0" />
              </HintedIconButton>
            ) : null}
            <HintedIconButton
              hint="Delete"
              aria-label={`Delete ${row.readable ? siteLabel(row.site) : row.site}`}
              placement="above"
              tone="danger"
              disabled={busy}
              onClick={() => setConfirmingDelete(row)}
            >
              <TrashIcon className="h-4 w-4 shrink-0" />
            </HintedIconButton>
          </>
        )}
      />

      {showingDeleted ? (
        <DeletedPasswords
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
          title={passwordPurgeConfirmationTitle(confirmingPurge.length)}
          subtitle={
            confirmingPurge.length === 1
              ? `${siteLabel(confirmingPurge[0].site)}${confirmingPurge[0].username === '' ? '' : ` · ${confirmingPurge[0].username}`}`
              : undefined
          }
          confirmLabel={busy ? 'Deleting…' : 'Delete permanently'}
          busy={busy}
          onKeep={() => setConfirmingPurge(undefined)}
          onConfirm={() => void purge(confirmingPurge)}
        >
          {PASSWORD_PURGE_CONFIRMATION}
        </ConfirmDeleteModal>
      ) : null}

      {confirmingDelete !== undefined ? (
        <ConfirmDeleteModal
          title="Delete this password?"
          subtitle={`${siteLabel(confirmingDelete.site)} · ${confirmingDelete.username}`}
          confirmLabel="Delete"
          busy={busy}
          onKeep={() => setConfirmingDelete(undefined)}
          onConfirm={() => void removeCredential(confirmingDelete.id)}
        >
          It disappears from every device, including your browser extensions. Its history is kept,
          so it can be restored from <strong>Recently deleted</strong> until it is deleted
          permanently{fullDevice ? '' : ' from a full device'}.
        </ConfirmDeleteModal>
      ) : null}

      {form !== undefined ? (
        <PasswordFormModal
          key={form.editing?.id ?? 'new'}
          editing={form.editing}
          busy={busy}
          onClose={() => setForm(undefined)}
          onSave={(encodedPayload) => void saveCredential(encodedPayload)}
          onError={(error) => setMessage(reportError(error))}
        />
      ) : null}

      <FloatingAddButton label="Add a password" disabled={busy} onClick={() => setForm({})} />
    </div>
  );
}
