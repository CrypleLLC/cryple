'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  createDocument,
  deleteDocuments,
  listDocumentsMeta,
  loadDocumentSummaries,
  type DocumentSummary,
} from '@/lib/documents';
import { moveItemsToFolder } from '@/lib/folders';
import {
  DOCUMENT_MINIATURE_TEXT_SHARE,
  DOCUMENT_MINIATURE_TITLE_SHARE,
  buildDocumentTiles,
  defaultIconSize,
  documentCountLabel,
  DOCUMENT_NOUNS,
  documentDeleteConfirmation,
  documentHref,
  gridTemplate,
  miniatureTextPixels,
  readIconSize,
  retainSelectable,
  UNTITLED_DOCUMENT,
  toggleNoteSelection,
  writeIconSize,
  type DocumentTile,
  type IconSize,
} from '@/lib/app';
import { openWithSessionHandoff } from '@/lib/session/handoff';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import { DocumentsIcon, TrashIcon } from '@/components/ui/icons';
import { Button, Card, Empty, FloatingAddButton, Notice, SizeStepper, Spinner } from '@/components/ui';
import { PageTile } from '@/components/tiles';
import ShareItemDialog from '@/components/sharing/ShareItemDialog';
import { startItemDrag } from '@/components/folders/FolderTabs';
import { FolderPath, FolderTile, MoveToFolder, useFolderTree } from '@/components/folders/FolderBrowser';

export default function DocumentsScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();

  const [summaries, setSummaries] = useState<DocumentSummary[]>();
  const [message, setMessage] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pageSize, setPageSize] = useState<IconSize>(defaultIconSize('documents'));

  useEffect(() => setPageSize(readIconSize('documents')), []);

  const resize = useCallback((next: IconSize) => {
    setPageSize(next);
    writeIconSize('documents', next);
  }, []);

  const reloadDocuments = useRef<() => void>(() => undefined);
  const itemsChanged = useCallback(() => reloadDocuments.current(), []);
  const tree = useFolderTree('documents', itemsChanged);
  const listing = tree.listing;
  const openFolder = tree.current;

  const load = useCallback(async () => {
    if (listing === undefined) {
      return;
    }
    try {
      const metas = await listDocumentsMeta(context, {
        folder: listing === '' ? undefined : listing,
      });
      const loaded = await loadDocumentSummaries(context, metas);

      setSummaries(loaded);
      setMessage(undefined);
      setSelected((current) =>
        retainSelectable(
          current,
          loaded.map((entry) => entry.id),
        ),
      );
    } catch (error) {
      setMessage(reportError(error));
      setSummaries([]);
    }
  }, [context, reportError, listing]);

  useEffect(() => {
    reloadDocuments.current = () => void load();
  }, [load]);

  useEffect(() => {
    setSelecting(false);
    setSelected([]);
    setConfirming(false);
    void load();
  }, [load]);

  const sameIds = useCallback((ids: string[]) => ids, []);

  const tiles = useMemo(
    () => (summaries === undefined ? undefined : buildDocumentTiles(summaries)),
    [summaries],
  );

  const openInNewTab = useCallback((id: string) => {
    openWithSessionHandoff(documentHref(id));
  }, []);

  const create = useCallback(async () => {
    setBusy(true);
    try {
      const { document } = await createDocument(context);
      if (openFolder !== null) {
        await moveItemsToFolder(context, 'documents', [document.id], openFolder);
      }
      openInNewTab(document.id);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }, [context, load, openFolder, openInNewTab, reportError]);

  const removeSelected = useCallback(async () => {
    setBusy(true);
    try {
      await deleteDocuments(context, selected);
      setSelecting(false);
      setSelected([]);
      setConfirming(false);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }, [context, load, reportError, selected]);

  function activate(id: string) {
    if (selecting) {
      setSelected((current) => toggleNoteSelection(current, id));
      return;
    }
    openInNewTab(id);
  }

  const path = (
    <FolderPath
      state={tree}
      rootLabel="Documents"
      rootIcon={<DocumentsIcon className="h-4 w-4 shrink-0" />}
      itemIdsFor={sameIds}
    />
  );

  if (tiles === undefined) {
    return (
      <div className="space-y-5">
        {path}
        <Spinner />
      </div>
    );
  }

  const folderTiles = tree.invalid ? [] : tree.children;

  return (
    <div className="space-y-5">
      {path}

      {message !== undefined && (
        <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
          {message}
        </Notice>
      )}

      {sharing ? (
        <ShareItemDialog
          itemType="document"
          itemId={sharing}
          onClose={() => setSharing(undefined)}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-compact text-ink-muted">
          {tiles.length > 0
            ? documentCountLabel(tiles.length)
            : openFolder === null
              ? 'No documents yet'
              : 'No documents in this folder'}
          {selecting && selected.length > 0 && ` · ${selected.length} selected`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {tiles.length + folderTiles.length > 0 && (
            <SizeStepper
              size={pageSize}
              onChange={resize}
              groupLabel="Document size"
              smallerLabel="Smaller documents"
              largerLabel="Larger documents"
            />
          )}
          {tiles.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                setSelecting((current) => !current);
                setSelected([]);
                setConfirming(false);
              }}
            >
              {selecting ? 'Cancel' : 'Select'}
            </Button>
          )}

          {selecting && <MoveToFolder state={tree} itemIds={selected} rootLabel="Documents" />}

          {fullDevice && selecting && selected.length > 0 && (
            <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
              <TrashIcon className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {confirming && (
        <Notice tone="warning">
          <p>{documentDeleteConfirmation(selected.length)}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void removeSelected()}>
              Delete permanently
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Keep them
            </Button>
          </div>
        </Notice>
      )}

      {tiles.length === 0 && folderTiles.length === 0 ? (
        <Card>
          <Empty icon={<DocumentsIcon className="h-6 w-6" />}>
            {openFolder === null
              ? 'Long-form writing, encrypted on this device before it is stored. Documents open in their own tab.'
              : 'This folder is empty. Drag documents onto it, or create one while it is open.'}
          </Empty>
        </Card>
      ) : (
        <ul
          className="grid gap-x-4 gap-y-6"
          style={{ gridTemplateColumns: gridTemplate('documents', pageSize) }}
        >
          {folderTiles.map((folder) => (
            <FolderTile
              key={folder.id}
              state={tree}
              folder={folder}
              nouns={DOCUMENT_NOUNS}
              frameClass="aspect-[210/297] w-full"
              itemIdsFor={sameIds}
            />
          ))}
          {tiles.map((tile) => (
            <DocumentFile
              key={tile.id}
              tile={tile}
              textPixels={miniatureTextPixels(pageSize, DOCUMENT_MINIATURE_TEXT_SHARE)}
              titlePixels={miniatureTextPixels(pageSize, DOCUMENT_MINIATURE_TITLE_SHARE)}
              selecting={selecting}
              selected={selected.includes(tile.id)}
              busy={busy}
              onOpen={() => activate(tile.id)}
              onDragStart={(event) =>
                startItemDrag(event, selected.includes(tile.id) ? selected : [tile.id])
              }
              onShare={() => setSharing(tile.id)}
              onToggle={() => {
                setSelecting(true);
                setSelected((current) => toggleNoteSelection(current, tile.id));
              }}
            />
          ))}
        </ul>
      )}

      {selecting ? null : (
        <FloatingAddButton
          label="New document"
          spread
          disabled={busy}
          onClick={() => void create()}
        />
      )}
    </div>
  );
}

function DocumentFile({
  tile,
  textPixels,
  titlePixels,
  selecting,
  selected,
  busy,
  onOpen,
  onShare,
  onToggle,
  onDragStart,
}: {
  tile: DocumentTile;
  textPixels: number;
  titlePixels: number;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onShare: () => void;
  onToggle: () => void;
  onDragStart: (event: DragEvent) => void;
}) {
  return (
    <PageTile
      title={tile.title}
      caption={tile.readable ? tile.edited : (tile.failure ?? 'Could not be decrypted here')}
      aspectClass="aspect-[210/297]"
      readable={tile.readable}
      unreadableIcon={DocumentsIcon}
      selecting={selecting}
      selected={selected}
      busy={busy}
      onOpen={onOpen}
      onShare={onShare}
      onToggle={onToggle}
      onDragStart={onDragStart}
    >
      <span className="block px-[12%] py-[8.5%]">
        {tile.title !== UNTITLED_DOCUMENT && (
          <span
            style={{ fontSize: `${titlePixels}px` }}
            className="mb-1 block truncate font-semibold leading-tight text-ink"
          >
            {tile.title}
          </span>
        )}
        <span
          style={{ fontSize: `${textPixels}px` }}
          className="block whitespace-pre-wrap break-words leading-[1.5] text-ink-soft"
        >
          {tile.thumbnail}
        </span>
      </span>
    </PageTile>
  );
}
