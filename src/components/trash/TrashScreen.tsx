'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { listTrash, purgeEntries, restoreEntries, type TrashEntry } from '@/lib/trash';
import type { TreeScope } from '@/lib/folders';
import {
  dateAndTimeLabels,
  fileExtension,
  fileKind,
  TRASH_COPY,
  trashEntryDetail,
  trashEntryName,
  trashExpiryLabel,
  trashRetentionNotice,
  trashSummary,
} from '@/lib/app';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import { Button, Card, Empty, HintedIconButton, Notice, Spinner } from '@/components/ui';
import { DocumentsIcon, FileTypeIcon, FolderGlyph, TrashIcon } from '@/components/ui/icons';
import { ConfirmDeleteModal } from '@/components/modal';

const TRASH_SCOPES: readonly TreeScope[] = ['documents', 'files'];

export default function TrashScreen() {
  const context = useAuthedContext();
  const { reportError, holds, fullDevice, account } = useCryple();
  const retentionDays = account?.retention_days ?? 0;
  const scopes = useMemo(() => TRASH_SCOPES.filter((scope) => holds(scope)), [holds]);

  const [entries, setEntries] = useState<TrashEntry[]>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string }>();
  const [purging, setPurging] = useState<TrashEntry[]>();

  const load = useCallback(async () => {
    try {
      const listing = await listTrash(context, scopes);
      setEntries(listing.entries);
      setFailed(listing.failed.length > 0);
    } catch (error) {
      setMessage({ tone: 'danger', text: reportError(error) });
      setEntries([]);
    }
  }, [context, scopes, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(selection: TrashEntry[]) {
    setBusy(true);
    setMessage(undefined);
    try {
      const restored = await restoreEntries(context, selection);
      setMessage({ tone: 'success', text: trashSummary(restored, 'restored') });
    } catch (error) {
      setMessage({
        tone: 'danger',
        text:
          error instanceof ApiError && error.code === 'QUOTA_EXCEEDED'
            ? TRASH_COPY.restoredOverQuota
            : reportError(error),
      });
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function purge(selection: TrashEntry[]) {
    setBusy(true);
    setMessage(undefined);
    try {
      const purged = await purgeEntries(context, selection);
      setMessage({ tone: 'success', text: trashSummary(purged, 'deleted') });
      setPurging(undefined);
    } catch (error) {
      setMessage({ tone: 'danger', text: reportError(error) });
    } finally {
      setBusy(false);
      await load();
    }
  }

  const emptying = purging !== undefined && entries !== undefined && purging.length === entries.length && entries.length > 1;

  return (
    <div className="space-y-6">
      <Notice tone="info">{trashRetentionNotice(retentionDays)}</Notice>

      {message ? (
        <Notice tone={message.tone} onDismiss={() => setMessage(undefined)}>
          {message.text}
        </Notice>
      ) : null}
      {failed ? <Notice tone="warning">{TRASH_COPY.unreadable}</Notice> : null}

      <Card
        title={TRASH_COPY.title}
        actions={
          fullDevice && entries !== undefined && entries.length > 1 ? (
            <Button variant="danger" disabled={busy} onClick={() => setPurging(entries)}>
              <TrashIcon className="h-4 w-4 shrink-0" />
              {TRASH_COPY.emptyTrash}
            </Button>
          ) : undefined
        }
      >
        {entries === undefined ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <Empty icon={<TrashIcon className="h-6 w-6" />}>{TRASH_COPY.empty}</Empty>
        ) : (
          <ul className="-my-3 divide-y divide-line">
            {entries.map((entry) => (
              <TrashRow
                key={entry.key}
                entry={entry}
                retentionDays={retentionDays}
                busy={busy}
                canPurge={fullDevice}
                onRestore={() => void restore([entry])}
                onPurge={() => setPurging([entry])}
              />
            ))}
          </ul>
        )}
        {!fullDevice && entries !== undefined && entries.length > 0 ? (
          <p className="mt-4 text-caption normal-case tracking-normal text-ink-muted">{TRASH_COPY.fullDeviceOnly}</p>
        ) : null}
      </Card>

      {purging !== undefined ? (
        <ConfirmDeleteModal
          title={emptying ? TRASH_COPY.emptyTitle : TRASH_COPY.purgeTitle(purging.length)}
          busy={busy}
          confirmLabel={busy ? TRASH_COPY.purging : emptying ? TRASH_COPY.emptyTrash : TRASH_COPY.purge}
          onKeep={() => setPurging(undefined)}
          onConfirm={() => void purge(purging)}
        >
          {emptying ? TRASH_COPY.emptyWarning : TRASH_COPY.purgeWarning}
        </ConfirmDeleteModal>
      ) : null}
    </div>
  );
}

function TrashRow({
  entry,
  retentionDays,
  busy,
  canPurge,
  onRestore,
  onPurge,
}: {
  entry: TrashEntry;
  retentionDays: number;
  busy: boolean;
  canPurge: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const name = trashEntryName(entry);
  const { date, time } = dateAndTimeLabels(entry.deletedAt);

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center">
          <TrashGlyph entry={entry} />
        </span>
        <div className="min-w-0">
          <p className={`truncate text-compact font-semibold ${entry.name === undefined ? 'italic text-ink-muted' : 'text-ink'}`}>
            {name}
          </p>
          <p className="truncate text-caption normal-case tracking-normal text-ink-muted">
            {trashEntryDetail(entry)} · Deleted {date} {time} · {trashExpiryLabel(entry.deletedAt, retentionDays)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={onRestore}>
          {TRASH_COPY.restore}
        </Button>
        {canPurge ? (
          <HintedIconButton
            hint={TRASH_COPY.purge}
            aria-label={`Delete ${name} for good`}
            placement="left"
            tone="danger"
            disabled={busy}
            onClick={onPurge}
          >
            <TrashIcon className="h-4 w-4 shrink-0" />
          </HintedIconButton>
        ) : null}
      </div>
    </li>
  );
}

function TrashGlyph({ entry }: { entry: TrashEntry }) {
  if (entry.kind === 'folder') {
    return (
      <span className="block h-9 w-9">
        <FolderGlyph open={false} />
      </span>
    );
  }
  if (entry.kind === 'document') {
    return <DocumentsIcon className="h-7 w-7 text-ink-muted" />;
  }
  return (
    <span className="block h-9 w-9">
      <FileTypeIcon
        kind={fileKind(entry.mime ?? 'application/octet-stream')}
        extension={entry.name === undefined ? '' : fileExtension(entry.name)}
      />
    </span>
  );
}
