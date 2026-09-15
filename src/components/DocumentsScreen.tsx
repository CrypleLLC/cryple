'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createDocument,
  deleteDocuments,
  listDocumentsMeta,
  loadDocumentSummaries,
  type DocumentSummary,
} from '@/lib/documents';
import {
  DOCUMENT_MINIATURE_TEXT_SHARE,
  DOCUMENT_MINIATURE_TITLE_SHARE,
  buildDocumentTiles,
  defaultIconSize,
  documentCountLabel,
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
import { useAuthedContext, useCryple } from './CrypleProvider';
import { CheckIcon, DocumentsIcon, PlusIcon, SharingIcon, TrashIcon } from './icons';
import { Button, Card, Empty, Notice, SizeStepper, Spinner } from './ui';
import ShareItemDialog from './ShareItemDialog';

export default function DocumentsScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

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

  const load = useCallback(async () => {
    try {
      const metas = await listDocumentsMeta(context);
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
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

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
      openInNewTab(document.id);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }, [context, load, openInNewTab, reportError]);

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

  if (tiles === undefined) {
    return <Spinner />;
  }

  return (
    <div className="space-y-5">
      {message !== undefined && <Notice tone="danger">{message}</Notice>}

      {sharing ? (
        <ShareItemDialog
          itemType="document"
          itemId={sharing}
          onClose={() => setSharing(undefined)}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-compact text-ink-muted">
          {tiles.length === 0 ? 'No documents yet' : documentCountLabel(tiles.length)}
          {selecting && selected.length > 0 && ` · ${selected.length} selected`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {tiles.length > 0 && (
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

          {selecting && selected.length > 0 && (
            <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
              <TrashIcon className="h-4 w-4" />
              Delete
            </Button>
          )}

          <Button variant="accent" disabled={busy} onClick={() => void create()}>
            <PlusIcon className="h-4 w-4" />
            New document
          </Button>
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

      {tiles.length === 0 ? (
        <Card>
          <Empty icon={<DocumentsIcon className="h-6 w-6" />}>
            Long-form writing, encrypted on this device before it is stored. Documents open in
            their own tab.
          </Empty>
        </Card>
      ) : (
        <ul
          className="grid gap-x-4 gap-y-6"
          style={{ gridTemplateColumns: gridTemplate('documents', pageSize) }}
        >
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
              onShare={() => setSharing(tile.id)}
              onToggle={() => {
                setSelecting(true);
                setSelected((current) => toggleNoteSelection(current, tile.id));
              }}
            />
          ))}
        </ul>
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
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-label={selecting ? `${selected ? 'Deselect' : 'Select'} ${tile.title}` : tile.title}
        className="flex w-full flex-col gap-2.5 rounded-xl p-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-60"
      >
        <span
          className={`relative block aspect-[210/297] w-full overflow-hidden rounded-xl bg-surface shadow-card transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lift ${
            selected ? 'ring-2 ring-brand-500' : 'ring-1 ring-line group-hover:ring-brand-200'
          }`}
        >
          {tile.readable ? (
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
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <DocumentsIcon className="h-[22%] w-[22%] text-ink-faint" />
            </span>
          )}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[18%] bg-gradient-to-t from-surface to-transparent" />
        </span>

        <span className="block min-w-0 px-0.5">
          <span className="block truncate text-compact font-semibold text-ink">{tile.title}</span>
          <span className="mt-0.5 block truncate text-caption normal-case tracking-normal text-ink-muted">
            {tile.readable ? tile.edited : (tile.failure ?? 'Could not be decrypted here')}
          </span>
        </span>
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${selected ? 'Deselect' : 'Select'} ${tile.title}`}
        disabled={busy}
        onClick={onToggle}
        className={`absolute left-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-md border shadow-card transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
          selected
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-line-strong bg-surface/90 text-transparent hover:border-brand-400'
        } ${selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <CheckIcon className="h-3.5 w-3.5 shrink-0" />
      </button>

      <button
        type="button"
        aria-label={`Share ${tile.title}`}
        disabled={busy || !tile.readable}
        onClick={onShare}
        className={`absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
          selecting ? 'opacity-0' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        <SharingIcon className="h-3 w-3 shrink-0" />
      </button>
    </li>
  );
}
