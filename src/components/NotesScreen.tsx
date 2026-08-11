'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteNotes, listNotes, openNote, type NoteRecord } from '@/lib/notes';
import {
  batchDeleteConfirmation,
  batchDeleteSummary,
  buildNoteTiles,
  noteCountLabel,
  retainSelectable,
  toggleNoteSelection,
  type NoteTile,
  type OpenedNote,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import NoteEditor from './NoteEditor';
import { CheckIcon, NotesIcon, PlusIcon, TrashIcon } from './icons';
import { Button, Empty, Notice, Spinner } from './ui';

type View = { mode: 'list' } | { mode: 'note'; id?: string };

export default function NotesScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [notes, setNotes] = useState<OpenedNote[]>();
  const [view, setView] = useState<View>({ mode: 'list' });
  const [message, setMessage] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const records = await listNotes(context);
      const opened = await Promise.all(
        records.map(async (record): Promise<OpenedNote> => {
          try {
            return { record, plaintext: await openNote(context, record) };
          } catch {
            return { record };
          }
        }),
      );

      setNotes(opened);
      setMessage(undefined);
      setSelected((current) =>
        retainSelectable(
          current,
          opened.map((entry) => entry.record.id),
        ),
      );
    } catch (error) {
      setMessage(reportError(error));
      setNotes([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const tiles = useMemo(() => (notes === undefined ? undefined : buildNoteTiles(notes)), [notes]);

  const closeEditor = useCallback(() => {
    setView({ mode: 'list' });
    void load();
  }, [load]);

  const noteSaved = useCallback((record: NoteRecord, plaintext: string) => {
    setView({ mode: 'note', id: record.id });
    setNotes((current) => mergeNote(current, record, plaintext));
  }, []);

  function stopSelecting() {
    setSelecting(false);
    setSelected([]);
    setConfirmingBatch(false);
  }

  function openTile(id: string) {
    if (selecting) {
      setSelected((current) => toggleNoteSelection(current, id));
      return;
    }
    stopSelecting();
    setView({ mode: 'note', id });
  }

  async function removeSelected() {
    setDeleting(true);
    try {
      const result = await deleteNotes(context, selected);
      setSelecting(false);
      setSelected([]);
      setConfirmingBatch(false);
      await load();
      setMessage(batchDeleteSummary(result));
    } catch (error) {
      setMessage(reportError(error));
      setConfirmingBatch(false);
    } finally {
      setDeleting(false);
    }
  }

  if (view.mode === 'note') {
    const opened = view.id === undefined ? undefined : notes?.find((n) => n.record.id === view.id);

    return (
      <NoteEditor opened={opened} onClose={closeEditor} onSaved={noteSaved} />
    );
  }

  return (
    <div className="space-y-5">
      {message ? <Notice tone="danger">{message}</Notice> : null}

      {tiles !== undefined && tiles.length > 0 ? (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
            {selecting ? `${selected.length} selected` : noteCountLabel(tiles.length)}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {selecting ? (
              <>
                <Button
                  variant="secondary"
                  disabled={deleting || selected.length === tiles.length}
                  onClick={() => setSelected(tiles.map((tile) => tile.id))}
                >
                  Select all
                </Button>
                <Button variant="secondary" disabled={deleting} onClick={stopSelecting}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={deleting || selected.length === 0}
                  onClick={() => setConfirmingBatch(true)}
                >
                  <TrashIcon />
                  {deleting ? 'Deleting…' : `Delete${selected.length > 0 ? ` (${selected.length})` : ''}`}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setSelecting(true)}>
                Select
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {confirmingBatch && selected.length > 0 ? (
        <Notice tone="danger">
          <p>{batchDeleteConfirmation(selected.length)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" disabled={deleting} onClick={() => void removeSelected()}>
              {deleting ? 'Deleting…' : `Delete ${noteCountLabel(selected.length)}`}
            </Button>
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => setConfirmingBatch(false)}
            >
              Keep them
            </Button>
          </div>
        </Notice>
      ) : null}

      {tiles === undefined ? (
        <Spinner />
      ) : tiles.length === 0 ? (
        <Empty>No notes yet. Use the button in the corner to write one.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {tiles.map((tile) => (
            <NoteFile
              key={tile.id}
              tile={tile}
              selecting={selecting}
              selected={selected.includes(tile.id)}
              busy={deleting}
              onOpen={() => openTile(tile.id)}
              onToggle={() => {
                setSelecting(true);
                setSelected((current) => toggleNoteSelection(current, tile.id));
              }}
            />
          ))}
        </ul>
      )}

      {selecting ? null : (
        <button
          type="button"
          aria-label="New note"
          title="New note"
          onClick={() => setView({ mode: 'note' })}
          className="fixed bottom-6 right-6 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg transition hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2"
        >
          <PlusIcon className="h-6 w-6 shrink-0" />
        </button>
      )}
    </div>
  );
}

function NoteFile({
  tile,
  selecting,
  selected,
  busy,
  onOpen,
  onToggle,
}: {
  tile: NoteTile;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-label={selecting ? `${selected ? 'Deselect' : 'Select'} ${tile.title}` : tile.title}
        className="flex w-full flex-col gap-2.5 rounded-lg p-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:opacity-60"
      >
        <span
          className={`relative block aspect-[3/4] w-full overflow-hidden rounded-md bg-white shadow-sm transition group-hover:shadow-md dark:bg-slate-900 ${
            selected
              ? 'ring-2 ring-brand-500'
              : 'ring-1 ring-slate-900/10 group-hover:ring-slate-900/20 dark:ring-white/10 dark:group-hover:ring-white/20'
          }`}
        >
          {tile.readable ? (
            <span className="block whitespace-pre-wrap break-words p-3 text-[9px] leading-[1.45] text-slate-600 dark:text-slate-400">
              {tile.thumbnail}
            </span>
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <NotesIcon className="h-8 w-8 text-slate-300 dark:text-slate-700" />
            </span>
          )}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />
        </span>

        <span className="block min-w-0 px-0.5">
          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {tile.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
            {new Date(tile.updatedAt).toLocaleDateString()}
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
        className={`absolute left-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded border shadow-sm transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${
          selected
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-slate-300 bg-white/90 text-transparent hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800/90'
        } ${selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <CheckIcon className="h-3.5 w-3.5 shrink-0" />
      </button>
    </li>
  );
}

function mergeNote(
  current: OpenedNote[] | undefined,
  record: NoteRecord,
  plaintext: string,
): OpenedNote[] {
  const entry: OpenedNote = { record, plaintext };
  if (current === undefined) {
    return [entry];
  }

  const index = current.findIndex((note) => note.record.id === record.id);
  if (index === -1) {
    return [entry, ...current];
  }

  const next = [...current];
  next[index] = entry;
  return next;
}
