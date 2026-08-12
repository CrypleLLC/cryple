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
  buildDocumentTiles,
  documentCountLabel,
  documentDeleteConfirmation,
  documentHref,
  retainSelectable,
  toggleNoteSelection,
  type DocumentTile,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { CheckIcon, PlusIcon, TrashIcon } from './icons';
import { Button, Empty, Notice, Spinner } from './ui';

export default function DocumentsScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [summaries, setSummaries] = useState<DocumentSummary[]>();
  const [message, setMessage] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

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
    window.open(documentHref(id), '_blank', 'noopener');
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {tiles.length === 0 ? 'No documents yet' : documentCountLabel(tiles.length)}
          {selecting && selected.length > 0 && ` · ${selected.length} selected`}
        </p>

        <div className="flex flex-wrap gap-2">
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

          <Button disabled={busy} onClick={() => void create()}>
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
        <Empty>
          Long-form writing, encrypted on this device before it is stored. Documents open in their
          own tab.
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tiles.map((tile) => (
            <DocumentCard
              key={tile.id}
              tile={tile}
              selecting={selecting}
              selected={selected.includes(tile.id)}
              onActivate={() => activate(tile.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentCard({
  tile,
  selecting,
  selected,
  onActivate,
}: {
  tile: DocumentTile;
  selecting: boolean;
  selected: boolean;
  onActivate: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onActivate}
        aria-pressed={selecting ? selected : undefined}
        className={`flex h-full w-full flex-col items-start gap-2 rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${
          selected
            ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-950'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
        }`}
      >
        <div className="flex w-full items-start justify-between gap-2">
          <span className="line-clamp-2 font-medium text-slate-900 dark:text-slate-100">
            {tile.title}
          </span>
          {selecting && selected && (
            <CheckIcon className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          )}
        </div>

        <p className="line-clamp-3 flex-1 text-sm text-slate-500 dark:text-slate-400">
          {tile.readable
            ? tile.preview
            : (tile.failure ?? 'This document could not be decrypted on this device.')}
        </p>

        <span className="text-xs text-slate-400 dark:text-slate-500">{tile.edited}</span>
      </button>
    </li>
  );
}
