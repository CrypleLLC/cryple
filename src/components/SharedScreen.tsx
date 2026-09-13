'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  describeReceived,
  listConnections,
  listInbox,
  openSharedFile,
  UNREADABLE_SHARED_NAME,
  type ConnectionRecord,
  type InboundShareRecord,
  type ReceivedItem,
} from '@/lib/sharing';
import {
  fileExtension,
  formatBytes,
  gridTemplate,
  iconScale,
  ITEM_LABELS,
  sharedNoteView,
  sharedSecretView,
  SHARING_COPY,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Card, Empty, Notice, Spinner } from './ui';
import { DocumentsIcon, FileTypeIcon, NotesIcon, SharingIcon, VaultIcon } from './icons';

const SCALE = iconScale('medium');

export default function SharedScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [items, setItems] = useState<ReceivedItem[]>();
  const [connections, setConnections] = useState(new Map<string, ConnectionRecord>());
  const [message, setMessage] = useState<string>();
  const [opened, setOpened] = useState<ReceivedItem>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [all, inbox] = await Promise.all([listConnections(context), listInbox(context)]);
      const byId = new Map(all.map((connection) => [connection.id, connection]));
      setConnections(byId);

      const described = await Promise.allSettled(
        inbox.map((share) =>
          describeReceived(
            context,
            share,
            byId.get(share.connection_id),
            sharedSecretView,
            sharedNoteView,
          ),
        ),
      );

      setItems(
        described.map((outcome, index) =>
          outcome.status === 'fulfilled'
            ? outcome.value
            : unreadable(inbox[index], String(outcome.reason)),
        ),
      );
    } catch (error) {
      setMessage(reportError(error));
      setItems([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(item: ReceivedItem) {
    if (item.itemType !== 'file') {
      setOpened(item);
      return;
    }

    const connection = connections.get(item.connectionId);
    if (!connection) {
      setMessage(SHARING_COPY.connectionGone);
      return;
    }

    setBusy(true);
    setMessage(undefined);

    try {
      const file = await openSharedFile(context, connection, item.shareId);
      const blob = new Blob([file.bytes as BlobPart], { type: file.manifest.mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.manifest.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  if (items === undefined) {
    return <Spinner />;
  }

  return (
    <div className="space-y-8">
      {message ? <Notice tone="danger">{message}</Notice> : null}

      {items.length === 0 ? (
        <Card title={SHARING_COPY.inboxTitle}>
          <Empty icon={<SharingIcon className="h-6 w-6" />}>
            {SHARING_COPY.inboxEmpty} {SHARING_COPY.sharedEmptyHint}
          </Empty>
        </Card>
      ) : (
        <ul
          className="grid gap-x-4 gap-y-6"
          style={{ gridTemplateColumns: gridTemplate('drive', 'medium') }}
        >
          {items.map((item) => (
            <SharedTile
              key={item.shareId}
              item={item}
              busy={busy}
              onOpen={() => void open(item)}
            />
          ))}
        </ul>
      )}

      {opened ? (
        <Card title={opened.name} subtitle={`${ITEM_LABELS[opened.itemType]} from ${opened.from}`}>
          {opened.text === undefined ? (
            <Notice tone="warning">{SHARING_COPY.documentNotReadable}</Notice>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-raised p-3 text-compact text-ink">
              {opened.text}
            </pre>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function unreadable(share: InboundShareRecord, problem: string): ReceivedItem {
  return {
    shareId: share.id,
    connectionId: share.connection_id,
    itemType: share.item_type,
    from: share.sender_username,
    createdAt: share.created_at,
    name: UNREADABLE_SHARED_NAME,
    readable: false,
    problem,
  };
}

function SharedTile({
  item,
  busy,
  onOpen,
}: {
  item: ReceivedItem;
  busy: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy || !item.readable}
        title={
          item.problem === undefined
            ? `${ITEM_LABELS[item.itemType]} from ${item.from}`
            : `Cannot be opened: ${item.problem}`
        }
        aria-label={`Open ${item.name}, ${ITEM_LABELS[item.itemType]} from ${item.from}`}
        className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg p-2 text-center transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-default disabled:opacity-60"
      >
        <span
          className="flex items-end justify-center"
          style={{ height: SCALE.glyphPixels, width: SCALE.glyphPixels }}
        >
          <SharedGlyph item={item} />
        </span>

        <span className="w-full truncate text-compact font-semibold text-ink">{item.name}</span>
        <span className="w-full truncate text-caption normal-case tracking-normal text-ink-muted">
          {item.sizeBytes === undefined
            ? ITEM_LABELS[item.itemType]
            : `${ITEM_LABELS[item.itemType]} · ${formatBytes(item.sizeBytes)}`}
        </span>
        <span className="w-full truncate text-caption normal-case tracking-normal text-ink-faint">
          from <span className="font-mono">{item.from}</span>
        </span>
        {item.problem !== undefined ? (
          <span className="w-full text-caption normal-case tracking-normal text-danger">
            {item.stale === true ? SHARING_COPY.staleConnection : item.problem}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function SharedGlyph({ item }: { item: ReceivedItem }) {
  if (item.itemType === 'file' && item.kind !== undefined) {
    return (
      <FileTypeIcon
        kind={item.kind}
        extension={item.readable ? fileExtension(item.name) : ''}
        labelled
      />
    );
  }

  const glyph = 'h-12 w-12 text-ink-muted';

  if (item.itemType === 'note') {
    return <NotesIcon className={glyph} />;
  }
  if (item.itemType === 'document') {
    return <DocumentsIcon className={glyph} />;
  }

  return <VaultIcon className={glyph} />;
}
