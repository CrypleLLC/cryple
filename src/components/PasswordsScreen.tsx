'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteCredential,
  listCredentials,
  openCredential,
  writeCredential,
} from '@/lib/credentials';
import {
  buildPasswordRows,
  encodeCredentialPayload,
  MASKED_PASSWORD,
  siteLabel,
  type OpenedCredential,
  type PasswordRow,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { useVaultReveal } from './VaultReveal';
import { PasswordsIcon, TrashIcon } from './icons';
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

interface Draft {
  site: string;
  username: string;
  password: string;
  note: string;
}

const EMPTY_DRAFT: Draft = { site: '', username: '', password: '', note: '' };

export default function PasswordsScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();
  const { revealed } = useVaultReveal();

  const [rows, setRows] = useState<PasswordRow[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [passwordRevealed, setPasswordRevealed] = useState(false);

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

  function closeForm() {
    setOpen(false);
    setDraft(EMPTY_DRAFT);
    setPasswordRevealed(false);
    setEditing(undefined);
  }

  async function saveCredential() {
    setBusy(true);
    try {
      await writeCredential(
        context,
        encodeCredentialPayload({
          site: draft.site.trim(),
          username: draft.username.trim(),
          password: draft.password,
          note: draft.note.trim(),
        }),
        editing === undefined ? {} : { credentialId: editing },
      );
      closeForm();
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  function editRow(row: PasswordRow) {
    setEditing(row.id);
    setDraft({ site: row.site, username: row.username, password: row.password, note: row.note });
    setPasswordRevealed(false);
    setOpen(true);
  }

  async function removeCredential(id: string) {
    setBusy(true);
    try {
      await deleteCredential(context, id);
      if (editing === id) {
        closeForm();
      }
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  const incomplete =
    draft.site.trim().length === 0 ||
    draft.username.trim().length === 0 ||
    draft.password.length === 0;

  return (
    <div className="space-y-8">
      <Card
        title="Saved passwords"
        subtitle="Site, username and password are encrypted on this device before they are stored."
      >
        {message ? (
          <div className="px-5 pt-4">
            <Notice tone="danger">{message}</Notice>
          </div>
        ) : null}

        {rows === undefined ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty icon={<PasswordsIcon className="h-6 w-6" />}>
            No passwords saved yet. Add your first one below — the server never sees the site you
            saved it for.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-raised text-caption uppercase text-ink-muted">
                  <th className="py-3 pl-5 pr-4 text-left">Site</th>
                  <th className="py-3 pr-4 text-left">Username</th>
                  <th className="py-3 pr-4 text-left">Password</th>
                  <th className="py-3 pr-4 text-left">Changed</th>
                  <th className="py-3 pl-4 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-brand-50/40">
                    <td className="max-w-[14rem] truncate py-3.5 pl-5 pr-4 text-compact font-semibold text-ink">
                      {row.readable ? siteLabel(row.site) : row.site}
                    </td>
                    <td className="max-w-[12rem] truncate py-3.5 pr-4 text-compact text-ink-soft">
                      {row.username}
                    </td>
                    <td className="max-w-[12rem] truncate py-3.5 pr-4 font-mono text-compact text-ink-soft">
                      {revealed && row.readable ? row.password : MASKED_PASSWORD}
                    </td>
                    <td className="whitespace-nowrap py-3.5 pr-4 text-caption normal-case tracking-normal text-ink-muted">
                      {new Date(row.changedAt).toLocaleString()}
                    </td>
                    <td className="py-3.5 pl-4 pr-5">
                      <div className="flex justify-end gap-2">
                        {row.readable ? <CopyButton value={row.password} label="Copy" /> : null}
                        {row.readable ? (
                          <Button variant="ghost" onClick={() => editRow(row)}>
                            Edit
                          </Button>
                        ) : null}
                        {fullDevice ? (
                          <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => void removeCredential(row.id)}
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

      {open ? (
        <Modal
          title={editing === undefined ? 'Add a password' : 'Edit password'}
          subtitle={
            editing === undefined
              ? 'Site, username and password are encrypted on this device before they are stored.'
              : 'Saving writes a new revision. The previous one is kept until you prune it.'
          }
          onClose={closeForm}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={closeForm}>
                Cancel
              </Button>
              <Button disabled={busy || incomplete} onClick={() => void saveCredential()}>
                {editing === undefined ? 'Add password' : 'Save revision'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field
              label="Site"
              value={draft.site}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, site: event.target.value })}
            />
            <Field
              label="Username"
              value={draft.username}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
            <SecretField
              label="Password"
              value={draft.password}
              onChange={(value) => setDraft({ ...draft, password: value })}
              revealed={passwordRevealed}
              onRevealedChange={setPasswordRevealed}
            />
            <Field
              label="Note"
              value={draft.note}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </div>
        </Modal>
      ) : null}

      <FloatingAddButton label="Add a password" disabled={busy} onClick={() => setOpen(true)} />

    </div>
  );
}
