'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteCredential,
  deletedCredentials,
  listCredentials,
  openCredential,
  restoreCredential,
  syncAllRevisions,
  writeCredential,
} from '@/lib/credentials';
import {
  buildPasswordRows,
  decodeCredentialPayload,
  MASKED_PASSWORD,
  siteLabel,
  type OpenedCredential,
  type PasswordRow,
} from '@/lib/app';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import { useVaultReveal } from '@/components/vault/VaultReveal';
import { PasswordsIcon, TrashIcon } from '@/components/ui/icons';
import { Button, CopyButton, FloatingAddButton } from '@/components/ui';
import { ConfirmDeleteModal } from '@/components/modal';
import { ItemList } from '@/components/item-list';
import DeletedPasswords, { type DeletedPasswordRow } from './DeletedPasswords';
import PasswordFormModal from './PasswordFormModal';

interface OpenForm {
  editing?: PasswordRow;
}

export default function PasswordsScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();
  const { revealed } = useVaultReveal();

  const [rows, setRows] = useState<PasswordRow[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<OpenForm>();
  const [confirmingDelete, setConfirmingDelete] = useState<PasswordRow>();
  const [deletedRows, setDeletedRows] = useState<DeletedPasswordRow[]>();

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
    } catch (error) {
      setMessage(reportError(error));
    }
  }, [context, reportError]);

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
      if (deletedRows !== undefined) {
        await loadDeleted();
      }
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <ItemList
        title="Saved passwords"
        subtitle="Site, username and password are encrypted on this device before they are stored."
        message={message}
        onDismissMessage={() => setMessage(undefined)}
        rows={rows}
        rowKey={(row) => row.id}
        emptyIcon={<PasswordsIcon className="h-6 w-6" />}
        emptyText="No passwords saved yet. Add your first one below — the server never sees the site you saved it for."
        columns={[
          {
            header: 'Site',
            kind: 'name',
            width: 'max-w-[14rem]',
            render: (row) => (row.readable ? siteLabel(row.site) : row.site),
          },
          { header: 'Username', kind: 'text', width: 'max-w-[12rem]', render: (row) => row.username },
          {
            header: 'Password',
            kind: 'secret',
            width: 'max-w-[12rem]',
            render: (row) => (revealed && row.readable ? row.password : MASKED_PASSWORD),
          },
          { header: 'Changed', kind: 'meta', render: (row) => new Date(row.changedAt).toLocaleString() },
        ]}
        actions={(row) => (
          <>
            {row.readable ? <CopyButton value={row.password} label="Copy" /> : null}
            {row.readable ? (
              <Button variant="ghost" onClick={() => setForm({ editing: row })}>
                Edit
              </Button>
            ) : null}
            <Button variant="danger" disabled={busy} onClick={() => setConfirmingDelete(row)}>
              <TrashIcon />
              Delete
            </Button>
          </>
        )}
      />

      <DeletedPasswords
        rows={deletedRows}
        busy={busy}
        onShow={() => void loadDeleted()}
        onRestore={(row) => void restore(row)}
      />

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
          so it can be restored from <strong>Recently deleted</strong> until it is pruned
          {fullDevice ? '' : ' from a full device'}.
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
