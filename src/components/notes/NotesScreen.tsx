'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { deleteNotes, listNotes, openNote, type NoteRecord } from '@/lib/notes';
import { HOME_FOLDER_ID } from '@/lib/folders';
import {
  NOTE_MINIATURE_TEXT_SHARE,
  batchDeleteConfirmation,
  batchDeleteSummary,
  buildNoteTiles,
  defaultIconSize,
  gridTemplate,
  miniatureTextPixels,
  NOTE_NOUNS,
  noteCountLabel,
  readIconSize,
  retainSelectable,
  toggleNoteSelection,
  writeIconSize,
  type IconSize,
  type NoteTile,
  type OpenedNote,
} from '@/lib/app';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import NoteEditor from './NoteEditor';
import { NotesIcon, TrashIcon } from '@/components/ui/icons';
import { Button, Card, Empty, FloatingAddButton, Notice, SizeStepper, Spinner } from '@/components/ui';
import { PageTile } from '@/components/tiles';
import ShareItemDialog from '@/components/sharing/ShareItemDialog';
import FolderTabs, { MoveToTab, startItemDrag, useFolderTabs } from '@/components/folders/FolderTabs';

type View = { mode: 'list' } | { mode: 'note'; id?: string };

export default function NotesScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();

  const [notes, setNotes] = useState<OpenedNote[]>();
  const [view, setView] = useState<View>({ mode: 'list' });
  const [message, setMessage] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [sharing, setSharing] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [pageSize, setPageSize] = useState<IconSize>(defaultIconSize('notes'));

  useEffect(() => setPageSize(readIconSize('notes')), []);

  const resize = useCallback((next: IconSize) => {
    setPageSize(next);
    writeIconSize('notes', next);
  }, []);

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

  const noteIds = useMemo(() => notes?.map((note) => note.record.id), [notes]);
  const folders = useFolderTabs('notes', noteIds);
  const filterTab = folders.filter;
  const fileInTab = folders.file;
  const inActiveTab = folders.active !== HOME_FOLDER_ID;

  const tiles = useMemo(
    () => (notes === undefined ? undefined : filterTab(buildNoteTiles(notes), (tile) => tile.id)),
    [notes, filterTab],
  );

  const deleteTabItems = useCallback(
    async (ids: string[]) => {
      await deleteNotes(context, ids);
      setSelected([]);
      await load();
    },
    [context, load],
  );

  const closeEditor = useCallback(() => {
    setView({ mode: 'list' });
    void load();
  }, [load]);

  const noteSaved = useCallback(
    (record: NoteRecord, plaintext: string) => {
      const created = notes?.some((note) => note.record.id === record.id) !== true;
      setView({ mode: 'note', id: record.id });
      setNotes((current) => mergeNote(current, record, plaintext));
      if (created && inActiveTab) {
        void fileInTab(record.id);
      }
    },
    [notes, inActiveTab, fileInTab],
  );

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
      await folders.forget(selected);
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
      <FolderTabs state={folders} nouns={NOTE_NOUNS} label="Note spaces" deleteItems={deleteTabItems} />

      {message ? (
        <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
          {message}
        </Notice>
      ) : null}

      {sharing ? (
        <ShareItemDialog itemType="note" itemId={sharing} onClose={() => setSharing(undefined)} />
      ) : null}

      {tiles !== undefined && tiles.length > 0 ? (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
          <p className="text-compact text-ink-muted" aria-live="polite">
            {selecting ? `${selected.length} selected` : noteCountLabel(tiles.length)}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <SizeStepper
              size={pageSize}
              onChange={resize}
              groupLabel="Note size"
              smallerLabel="Smaller notes"
              largerLabel="Larger notes"
            />
            {selecting ? (
              <>
                <MoveToTab
                  state={folders}
                  itemIds={selected}
                  label={`Move ${noteCountLabel(selected.length)} to another space`}
                />
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
                {fullDevice ? (
                  <Button
                    variant="danger"
                    disabled={deleting || selected.length === 0}
                    onClick={() => setConfirmingBatch(true)}
                  >
                    <TrashIcon />
                    {deleting ? 'Deleting…' : `Delete${selected.length > 0 ? ` (${selected.length})` : ''}`}
                  </Button>
                ) : null}
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
        <Card>
          <Empty icon={<NotesIcon className="h-6 w-6" />}>
            {notes !== undefined && notes.length > 0
              ? 'This space is empty. Drag a note onto its name, or write one while the space is open.'
              : 'No notes yet. Use the button in the corner to write one — it is encrypted on this device before it is stored.'}
          </Empty>
        </Card>
      ) : (
        <ul
          className="grid gap-x-4 gap-y-6"
          style={{ gridTemplateColumns: gridTemplate('notes', pageSize) }}
        >
          {tiles.map((tile) => (
            <NoteFile
              key={tile.id}
              tile={tile}
              textPixels={miniatureTextPixels(pageSize, NOTE_MINIATURE_TEXT_SHARE)}
              selecting={selecting}
              selected={selected.includes(tile.id)}
              busy={deleting}
              onOpen={() => openTile(tile.id)}
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
        <FloatingAddButton label="New note" spread onClick={() => setView({ mode: 'note' })} />
      )}
    </div>
  );
}

function NoteFile({
  tile,
  textPixels,
  selecting,
  selected,
  busy,
  onOpen,
  onShare,
  onToggle,
  onDragStart,
}: {
  tile: NoteTile;
  textPixels: number;
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
      caption={new Date(tile.updatedAt).toLocaleDateString()}
      aspectClass="aspect-[3/4]"
      readable={tile.readable}
      unreadableIcon={NotesIcon}
      selecting={selecting}
      selected={selected}
      busy={busy}
      onOpen={onOpen}
      onShare={onShare}
      onToggle={onToggle}
      onDragStart={onDragStart}
    >
      <span
        style={{ fontSize: `${textPixels}px` }}
        className="block whitespace-pre-wrap break-words p-[6%] leading-[1.45] text-ink-soft"
      >
        {tile.thumbnail}
      </span>
    </PageTile>
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
