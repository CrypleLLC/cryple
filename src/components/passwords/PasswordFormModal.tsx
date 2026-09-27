'use client';

import { useState } from 'react';
import { listRevisions, openCredential } from '@/lib/credentials';
import {
  decodeCredentialPayload,
  encodeCredentialPayload,
  MASKED_PASSWORD,
  type CredentialPayload,
  type PasswordRow,
  type SiteMatch,
} from '@/lib/app';
import { useAuthedContext } from '@/components/session/CrypleProvider';
import { Button, CopyButton, Field, SecretField, Select } from '@/components/ui';
import { FormModal } from '@/components/modal';

interface Draft {
  site: string;
  username: string;
  password: string;
  note: string;
  urls: string;
  match: SiteMatch;
  base?: CredentialPayload;
}

const EMPTY_DRAFT: Draft = { site: '', username: '', password: '', note: '', urls: '', match: 'domain' };

interface PreviousPassword {
  revisionId: string;
  password: string;
  changedAt: string;
}

function draftFrom(row: PasswordRow | undefined): Draft {
  if (row === undefined) {
    return EMPTY_DRAFT;
  }
  return {
    site: row.site,
    username: row.username,
    password: row.password,
    note: row.note,
    urls: (row.payload?.urls ?? []).join('\n'),
    match: row.payload?.match ?? 'domain',
    base: row.payload,
  };
}

export default function PasswordFormModal({
  editing,
  busy,
  onClose,
  onSave,
  onError,
}: {
  editing?: PasswordRow;
  busy: boolean;
  onClose: () => void;
  onSave: (encodedPayload: string) => void;
  onError: (error: unknown) => void;
}) {
  const context = useAuthedContext();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(editing));
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [previous, setPrevious] = useState<PreviousPassword[]>();

  async function showPrevious(credentialId: string) {
    try {
      const revisions = await listRevisions(context, credentialId);
      const older = revisions.filter((revision) => !revision.deleted).slice(1);
      const opened = await Promise.all(
        older.map(async (revision): Promise<PreviousPassword | undefined> => {
          try {
            const payload = decodeCredentialPayload(await openCredential(context, revision));
            return { revisionId: revision.revision_id, password: payload.password, changedAt: revision.created_at };
          } catch {
            return undefined;
          }
        }),
      );
      setPrevious(opened.filter((entry): entry is PreviousPassword => entry !== undefined));
    } catch (error) {
      onError(error);
    }
  }

  function save() {
    onSave(
      encodeCredentialPayload({
        ...(draft.base ?? {}),
        site: draft.site.trim(),
        username: draft.username.trim(),
        password: draft.password,
        note: draft.note.trim(),
        urls: draft.urls.split(/[\n,]/),
        match: draft.match,
      }),
    );
  }

  const complete =
    draft.site.trim().length > 0 && draft.username.trim().length > 0 && draft.password.length > 0;

  return (
    <FormModal
      title={editing === undefined ? 'Add a password' : 'Edit password'}
      subtitle={
        editing === undefined
          ? 'Site, username and password are encrypted on this device before they are stored.'
          : 'Saving writes a new revision. The previous one is kept until you prune it.'
      }
      submitLabel={editing === undefined ? 'Add password' : 'Save revision'}
      canSubmit={complete}
      busy={busy}
      onClose={onClose}
      onSubmit={save}
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
        <Field
          label="Also used on"
          hint="Other addresses this login works on, separated by commas."
          value={draft.urls.replace(/\n/g, ', ')}
          autoComplete="off"
          onChange={(event) => setDraft({ ...draft, urls: event.target.value })}
        />
        <Select
          label="Offer it on"
          value={draft.match}
          onChange={(event) => setDraft({ ...draft, match: event.target.value as SiteMatch })}
          choices={[
            { value: 'domain', label: 'Any address of the same site' },
            { value: 'host', label: 'Only these exact addresses' },
          ]}
        />
        {editing !== undefined ? (
          previous === undefined ? (
            <Button variant="ghost" onClick={() => void showPrevious(editing.id)}>
              Show previous passwords
            </Button>
          ) : previous.length === 0 ? (
            <p className="text-compact text-ink-muted">No previous passwords.</p>
          ) : (
            <div>
              <p className="text-compact font-semibold text-ink-soft">Previous passwords</p>
              <ul className="mt-2 divide-y divide-line">
                {previous.map((entry) => (
                  <li key={entry.revisionId} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate font-mono text-compact text-ink-soft">
                      {passwordRevealed ? entry.password : MASKED_PASSWORD}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-caption normal-case tracking-normal text-ink-muted">
                        {new Date(entry.changedAt).toLocaleDateString()}
                      </span>
                      <CopyButton value={entry.password} label="Copy" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}
      </div>
    </FormModal>
  );
}
