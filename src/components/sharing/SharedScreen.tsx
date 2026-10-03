'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  NothingToCopyError,
  copySharedItem,
  describeReceived,
  describeSent,
  inboundShare,
  listConnectionShares,
  listConnections,
  listInbox,
  openSentFile,
  openSharedFile,
  sharableItemTypes,
  UNREADABLE_SHARED_NAME,
  type ConnectionRecord,
  type InboundShareRecord,
  type ReceivedItem,
  type SharedFile,
} from '@/lib/sharing';
import {
  browserCanPlayVideo,
  fileExtension,
  formatBytes,
  friendshipFolders,
  mediaKindOf,
  gridTemplate,
  iconScale,
  sharedItemSubtitle,
  sharedNoteView,
  sharedSecretView,
  sharesInFolder,
  SHARING_COPY,
  type FolderNouns,
  type ViewableMedia,
} from '@/lib/app';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';
import { scopeForItemType } from '@/lib/scopes';
import { Button, Card, Empty, Notice, Spinner } from '@/components/ui';
import {
  DocumentsIcon,
  FileTypeIcon,
  FolderGlyph,
  NotesIcon,
  SharingIcon,
  VaultIcon,
} from '@/components/ui/icons';
import { MediaViewer, type MediaLoader } from '@/components/modal';
import { FolderPath, FolderTile, MoveToFolder } from '@/components/folders/FolderBrowser';
import { FolderDetailsPanel } from '@/components/folders/FolderDetailsPanel';
import { startItemDrag } from '@/components/folders/FolderTabs';
import { useSharedFolderTree } from './useSharedFolderTree';

const SCALE = iconScale('medium');
const SHARED_NOUNS: FolderNouns = { one: 'item', many: 'items' };
const sameIds = (ids: string[]) => ids;

export default function SharedScreen() {
  const context = useAuthedContext();
  const { reportError } = useZekke();

  const [connections, setConnections] = useState<ConnectionRecord[]>();
  const [openId, setOpenId] = useState<string>();
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    try {
      setConnections(friendshipFolders(await listConnections(context)));
    } catch (error) {
      setMessage(reportError(error));
      setConnections([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (connections === undefined) {
    return <Spinner />;
  }

  const opened = connections.find((connection) => connection.id === openId);

  return (
    <div className="space-y-8">
      {message ? (
        <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
          {message}
        </Notice>
      ) : null}

      {opened === undefined ? (
        <FriendshipGrid connections={connections} onOpen={setOpenId} />
      ) : (
        <FriendshipSpace key={opened.id} connection={opened} onBack={() => setOpenId(undefined)} />
      )}
    </div>
  );
}

function FriendshipGrid({
  connections,
  onOpen,
}: {
  connections: readonly ConnectionRecord[];
  onOpen: (id: string) => void;
}) {
  if (connections.length === 0) {
    return (
      <Card title={SHARING_COPY.sharedRoot}>
        <Empty icon={<SharingIcon className="h-6 w-6" />}>{SHARING_COPY.friendshipsEmpty}</Empty>
      </Card>
    );
  }

  return (
    <ul className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: gridTemplate('drive', 'medium') }}>
      {connections.map((connection) => (
        <li key={connection.id} className="group relative">
          <button
            type="button"
            onClick={() => onOpen(connection.id)}
            aria-label={`Open what you share with ${connection.username}`}
            className="flex w-full flex-col items-center gap-1.5 rounded-lg p-2 text-center transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <span
              className="flex items-end justify-center drop-shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5"
              style={{ height: SCALE.glyphPixels, width: SCALE.glyphPixels }}
            >
              <span className="block h-full w-full">
                <FolderGlyph open={false} />
              </span>
            </span>
            <span className="w-full truncate text-compact font-semibold text-ink">{connection.username}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FriendshipSpace({ connection, onBack }: { connection: ConnectionRecord; onBack: () => void }) {
  const { holds } = useZekke();

  return holds('sharing') ? (
    <OrganisedSpace connection={connection} onBack={onBack} />
  ) : (
    <FlatSpace connection={connection} onBack={onBack} />
  );
}

function useSpaceItems(connection: ConnectionRecord, organised: boolean) {
  const context = useAuthedContext();
  const { reportError } = useZekke();
  const [items, setItems] = useState<ReceivedItem[]>();
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    try {
      const held = new Set(sharableItemTypes(context));
      const described = organised
        ? await describeBothWays(context, connection, held)
        : await describeInbound(context, connection, held);
      setItems(described);
    } catch (error) {
      setMessage(reportError(error));
      setItems([]);
    }
  }, [context, connection, organised, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, message, setMessage };
}

async function describeBothWays(
  context: ReturnType<typeof useAuthedContext>,
  connection: ConnectionRecord,
  held: ReadonlySet<string>,
): Promise<ReceivedItem[]> {
  const shares = (await listConnectionShares(context, connection.id)).filter((share) => held.has(share.item_type));
  const described = await Promise.allSettled(
    shares.map((share) =>
      share.direction === 'inbound'
        ? describeReceived(context, inboundShare(share, connection), connection, sharedSecretView, sharedNoteView)
        : describeSent(context, share, connection, sharedSecretView, sharedNoteView),
    ),
  );
  return described.map((outcome, index) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : unreadable(shares[index], connection, shares[index].direction, String(outcome.reason)),
  );
}

async function describeInbound(
  context: ReturnType<typeof useAuthedContext>,
  connection: ConnectionRecord,
  held: ReadonlySet<string>,
): Promise<ReceivedItem[]> {
  const inbox = (await listInbox(context)).filter(
    (share) => share.connection_id === connection.id && held.has(share.item_type),
  );
  const described = await Promise.allSettled(
    inbox.map((share) => describeReceived(context, share, connection, sharedSecretView, sharedNoteView)),
  );
  return described.map((outcome, index) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : unreadable(inbox[index], connection, 'inbound', String(outcome.reason)),
  );
}

function OrganisedSpace({ connection, onBack }: { connection: ConnectionRecord; onBack: () => void }) {
  const tree = useSharedFolderTree(connection);
  const { items, message, setMessage } = useSpaceItems(connection, true);
  const [details, setDetails] = useState<string>();

  const { invalid, manifest, current } = tree;
  const usable = tree.folders !== undefined && !invalid;
  const visible = useMemo(
    () => sharesInFolder(items ?? [], invalid ? undefined : manifest, current),
    [items, invalid, manifest, current],
  );
  const detailsFolder = tree.folders?.find((folder) => folder.id === details);

  return (
    <div className="space-y-6">
      <FolderPath
        state={tree}
        rootLabel={connection.username}
        rootIcon={<SharingIcon className="h-4 w-4 shrink-0" />}
        itemIdsFor={sameIds}
        onDetails={(id) => setDetails((open) => (open === id ? undefined : id))}
        ancestors={[{ label: SHARING_COPY.sharedRoot, onOpen: onBack }]}
        invalidNotice={
          <Notice tone="warning">
            <div className="space-y-3">
              <p>{SHARING_COPY.sharedFoldersInvalid}</p>
              <Button variant="secondary" disabled={tree.busy} onClick={() => void tree.reset()}>
                {SHARING_COPY.sharedFoldersReset}
              </Button>
            </div>
          </Notice>
        }
      />

      <SpaceContents
        connection={connection}
        items={items}
        visible={visible}
        message={message}
        setMessage={setMessage}
        folderTiles={
          usable
            ? tree.children.map((folder) => (
                <FolderTile
                  key={folder.id}
                  state={tree}
                  folder={folder}
                  nouns={SHARED_NOUNS}
                  glyphPixels={SCALE.glyphPixels}
                  labelClass={SCALE.labelClass}
                  itemIdsFor={sameIds}
                  onDetails={() => setDetails((open) => (open === folder.id ? undefined : folder.id))}
                />
              ))
            : []
        }
        draggable={usable && !tree.busy}
        moveTo={(item) =>
          usable ? <MoveToFolder state={tree} itemIds={[item.shareId]} rootLabel={connection.username} /> : null
        }
      />

      {detailsFolder !== undefined ? (
        <FolderDetailsPanel state={tree} folder={detailsFolder} onClose={() => setDetails(undefined)} />
      ) : null}
    </div>
  );
}

function FlatSpace({ connection, onBack }: { connection: ConnectionRecord; onBack: () => void }) {
  const { items, message, setMessage } = useSpaceItems(connection, false);

  return (
    <div className="space-y-6">
      <nav aria-label="Folder path" className="flex items-center gap-0.5 border-b border-line pb-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-2 py-1.5 text-compact font-semibold text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {SHARING_COPY.sharedRoot}
        </button>
        <span aria-hidden="true" className="px-0.5 text-ink-faint">
          /
        </span>
        <span className="flex items-center gap-1.5 px-2 py-1.5 text-compact font-semibold text-ink">
          <SharingIcon className="h-4 w-4 shrink-0" />
          {connection.username}
        </span>
      </nav>
      <Notice tone="info">{SHARING_COPY.friendshipFlat}</Notice>
      <SpaceContents
        connection={connection}
        items={items}
        visible={items ?? []}
        message={message}
        setMessage={setMessage}
        folderTiles={[]}
        draggable={false}
        moveTo={() => null}
      />
    </div>
  );
}

function SpaceContents({
  connection,
  items,
  visible,
  message,
  setMessage,
  folderTiles,
  draggable,
  moveTo,
}: {
  connection: ConnectionRecord;
  items: ReceivedItem[] | undefined;
  visible: ReceivedItem[];
  message: string | undefined;
  setMessage: (message: string | undefined) => void;
  folderTiles: ReactNode[];
  draggable: boolean;
  moveTo: (item: ReceivedItem) => ReactNode;
}) {
  const context = useAuthedContext();
  const { reportError, holds } = useZekke();
  const [notice, setNotice] = useState<string>();
  const [openedId, setOpenedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<number>();

  const media = useMemo(
    () =>
      visible.flatMap((item): ViewableMedia[] => {
        if (item.itemType !== 'file' || !item.readable || item.kind === undefined || item.mime === undefined) {
          return [];
        }
        const kind = mediaKindOf(item.kind, item.mime, browserCanPlayVideo);
        return kind === undefined ? [] : [{ id: item.shareId, name: item.name, mime: item.mime, kind }];
      }),
    [visible],
  );

  const openFile = useCallback(
    (item: ReceivedItem): Promise<SharedFile> =>
      item.direction === 'outbound'
        ? openSentFile(context, item.itemId)
        : openSharedFile(context, connection, item.shareId),
    [context, connection],
  );

  const loadMedia = useCallback<MediaLoader>(
    async (entry) => {
      const item = items?.find((candidate) => candidate.shareId === entry.id);
      if (item === undefined) {
        throw new Error(SHARING_COPY.lostConnection);
      }
      return (await openFile(item)).bytes;
    },
    [items, openFile],
  );

  if (items === undefined) {
    return <Spinner />;
  }

  const opened = items.find((item) => item.shareId === openedId);

  function open(item: ReceivedItem) {
    setNotice(undefined);
    setOpenedId(item.shareId);
    const mediaIndex = media.findIndex((candidate) => candidate.id === item.shareId);
    if (mediaIndex >= 0) {
      setViewing(mediaIndex);
    }
  }

  async function copy(item: ReceivedItem) {
    setBusy(true);
    setMessage(undefined);
    try {
      await copySharedItem(context, connection, { id: item.shareId, item_type: item.itemType });
      setNotice(SHARING_COPY.copied);
    } catch (error) {
      setMessage(error instanceof NothingToCopyError ? SHARING_COPY.nothingToCopy : reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function download(item: ReceivedItem) {
    setBusy(true);
    setMessage(undefined);
    try {
      const file = await openFile(item);
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

  return (
    <div className="space-y-6">
      {message ? (
        <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
          {message}
        </Notice>
      ) : null}

      {folderTiles.length === 0 && visible.length === 0 ? (
        <Empty icon={<SharingIcon className="h-6 w-6" />}>{SHARING_COPY.friendshipEmpty}</Empty>
      ) : (
        <ul className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: gridTemplate('drive', 'medium') }}>
          {folderTiles}
          {visible.map((item) => (
            <SharedTile
              key={item.shareId}
              item={item}
              busy={busy}
              draggable={draggable}
              onOpen={() => open(item)}
            />
          ))}
        </ul>
      )}

      {viewing !== undefined && media.length > 0 ? (
        <MediaViewer
          items={media}
          startIndex={Math.min(viewing, media.length - 1)}
          load={loadMedia}
          explain={reportError}
          onDownload={(entry) => {
            const item = items.find((candidate) => candidate.shareId === entry.id);
            if (item !== undefined) {
              void download(item);
            }
          }}
          onClose={() => setViewing(undefined)}
        />
      ) : null}

      {opened ? (
        <Card title={opened.name} subtitle={sharedItemSubtitle(opened)}>
          <div className="space-y-4">
            {notice ? (
              <Notice tone="success" onDismiss={() => setNotice(undefined)}>
                {notice}
              </Notice>
            ) : null}
            {opened.itemType === 'file' ? null : opened.text === undefined ? (
              <Notice tone="warning">{SHARING_COPY.documentNotReadable}</Notice>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-raised p-3 text-compact text-ink">
                {opened.text}
              </pre>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {opened.itemType === 'file' ? (
                <Button disabled={busy} onClick={() => void download(opened)}>
                  {busy ? SHARING_COPY.opening : SHARING_COPY.download}
                </Button>
              ) : null}
              {opened.direction === 'inbound' && holds(scopeForItemType(opened.itemType)) ? (
                <Button variant="secondary" disabled={busy} onClick={() => void copy(opened)}>
                  {busy ? SHARING_COPY.copying : SHARING_COPY.copyToMyAccount}
                </Button>
              ) : null}
              {moveTo(opened)}
            </div>
            {opened.direction === 'inbound' ? (
              <p className="text-caption normal-case tracking-normal text-ink-muted">{SHARING_COPY.copyExplain}</p>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function unreadable(
  share: Pick<InboundShareRecord, 'id' | 'item_type' | 'item_id' | 'created_at'>,
  connection: ConnectionRecord,
  direction: ReceivedItem['direction'],
  problem: string,
): ReceivedItem {
  return {
    shareId: share.id,
    connectionId: connection.id,
    itemType: share.item_type,
    itemId: share.item_id,
    direction,
    counterparty: connection.username,
    createdAt: share.created_at,
    name: UNREADABLE_SHARED_NAME,
    readable: false,
    problem,
  };
}

function SharedTile({
  item,
  busy,
  draggable,
  onOpen,
}: {
  item: ReceivedItem;
  busy: boolean;
  draggable: boolean;
  onOpen: () => void;
}) {
  const subtitle = sharedItemSubtitle(item);

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy || !item.readable}
        draggable={draggable}
        onDragStart={(event) => startItemDrag(event, [item.shareId])}
        title={
          item.problem === undefined
            ? `${subtitle}${item.sizeBytes === undefined ? '' : ` · ${formatBytes(item.sizeBytes)}`}`
            : `Cannot be opened: ${item.problem}`
        }
        aria-label={`Open ${item.name}, ${subtitle}`}
        className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg p-2 text-center transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-default disabled:opacity-60"
      >
        <span
          className="flex items-end justify-center"
          style={{ height: SCALE.glyphPixels, width: SCALE.glyphPixels }}
        >
          <SharedGlyph item={item} />
        </span>

        <span className="w-full truncate text-compact font-semibold text-ink">{item.name}</span>
        {item.direction === 'outbound' ? (
          <span className="w-full truncate text-caption normal-case tracking-normal text-ink-muted">
            {SHARING_COPY.sentByYou}
          </span>
        ) : null}
        {item.problem !== undefined ? (
          <span className="w-full text-caption normal-case tracking-normal text-danger">{item.problem}</span>
        ) : null}
      </button>
    </li>
  );
}

function SharedGlyph({ item }: { item: ReceivedItem }) {
  if (item.itemType === 'file' && item.kind !== undefined) {
    return <FileTypeIcon kind={item.kind} extension={item.readable ? fileExtension(item.name) : ''} />;
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
