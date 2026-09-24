'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent, ReactNode } from 'react';
import {
  canCreateIn,
  canMoveFolder,
  childrenOf,
  createTreeFolder,
  deleteTreeFolder,
  descendantsOf,
  FolderManifestInvalidError,
  FolderTreeProblemError,
  listTreeFolders,
  moveItemsToFolder,
  moveTreeFolder,
  pathTo,
  renameTreeFolder,
  ROOT_FOLDER,
  type FolderDeletion,
  type TreeFolder,
  type TreeScope,
} from '@/lib/folders';
import {
  folderDeleteConfirmation,
  folderMoveProblem,
  folderNameProblem,
  INVALID_TREE_MESSAGE,
  UNREADABLE_FOLDER,
  type FolderNouns,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { DRAGGED_ITEMS_TYPE } from './FolderTabs';
import { FolderGlyph, FolderPlusIcon, PencilIcon, TrashIcon } from './icons';
import { Button, Field, Modal, Notice } from './ui';

export const DRAGGED_FOLDER_TYPE = 'application/x-cryple-folder';

export function startFolderDrag(event: ReactDragEvent, id: string) {
  event.dataTransfer.setData(DRAGGED_FOLDER_TYPE, id);
  event.dataTransfer.effectAllowed = 'move';
}

function isInternalDrag(event: ReactDragEvent): boolean {
  const types = event.dataTransfer.types;
  return types.includes(DRAGGED_ITEMS_TYPE) || types.includes(DRAGGED_FOLDER_TYPE);
}

export function isFileDrop(event: ReactDragEvent): boolean {
  return event.dataTransfer.types.includes('Files') && !isInternalDrag(event);
}

function readDrop(event: ReactDragEvent): { folder?: string; items: string[] } {
  const folder = event.dataTransfer.getData(DRAGGED_FOLDER_TYPE);
  let items: string[] = [];
  try {
    const parsed: unknown = JSON.parse(event.dataTransfer.getData(DRAGGED_ITEMS_TYPE) || '[]');
    items = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    items = [];
  }
  return { folder: folder === '' ? undefined : folder, items };
}

export function folderLabel(folder: TreeFolder): string {
  return folder.name ?? UNREADABLE_FOLDER;
}

export interface FolderTreeState {
  folders: TreeFolder[] | undefined;
  current: string | null;
  open: (id: string | null) => void;
  path: TreeFolder[];
  children: TreeFolder[];
  invalid: boolean;
  message: string | undefined;
  setMessage: (message: string | undefined) => void;
  busy: boolean;
  listing: string | undefined;
  create: (name: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<FolderDeletion | undefined>;
  moveFolder: (id: string, target: string | null) => Promise<boolean>;
  moveItems: (ids: readonly string[], target: string | null) => Promise<boolean>;
  reload: () => Promise<void>;
}

export function useFolderTree(scope: TreeScope, onItemsChanged: () => void): FolderTreeState {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [folders, setFolders] = useState<TreeFolder[]>();
  const [current, setCurrent] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const explain = useCallback(
    (error: unknown) =>
      error instanceof FolderTreeProblemError ? folderMoveProblem(error.code) : reportError(error),
    [reportError],
  );

  const reload = useCallback(async () => {
    try {
      const loaded = await listTreeFolders(context, scope);
      setFolders(loaded);
      setInvalid(false);
      setCurrent((open) => (open !== null && !loaded.some((folder) => folder.id === open) ? null : open));
    } catch (error) {
      if (error instanceof FolderManifestInvalidError) {
        setInvalid(true);
        setFolders([]);
        setCurrent(null);
        return;
      }
      setMessage(explain(error));
      setFolders((existing) => existing ?? []);
    }
  }, [context, scope, explain]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async <T,>(work: () => Promise<T>, after?: () => void): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await work();
        setMessage(undefined);
        await reload();
        after?.();
        return result;
      } catch (error) {
        setMessage(explain(error));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [reload, explain],
  );

  const path = useMemo(() => pathTo(folders ?? [], current), [folders, current]);
  const children = useMemo(() => childrenOf(folders ?? [], current), [folders, current]);

  return {
    folders,
    current,
    open: setCurrent,
    path,
    children,
    invalid,
    message,
    setMessage,
    busy,
    listing: folders === undefined ? undefined : invalid ? '' : (current ?? ROOT_FOLDER),
    create: async (name) =>
      (await run(() => createTreeFolder(context, scope, { name, parentId: current }))) !== undefined,
    rename: async (id, name) => (await run(() => renameTreeFolder(context, scope, id, name))) !== undefined,
    remove: (id) => run(() => deleteTreeFolder(context, scope, id), onItemsChanged),
    moveFolder: async (id, target) =>
      (await run(() => moveTreeFolder(context, scope, id, target))) !== undefined,
    moveItems: async (ids, target) =>
      (await run(() => moveItemsToFolder(context, scope, ids, target), onItemsChanged)) !== undefined,
    reload,
  };
}

function useDropTarget(state: FolderTreeState, target: string | null, itemIdsFor: (ids: string[]) => string[]) {
  const [over, setOver] = useState(false);

  const accepts = (event: ReactDragEvent) => {
    if (!isInternalDrag(event)) {
      return false;
    }
    return true;
  };

  return {
    over,
    props: {
      onDragOver: (event: ReactDragEvent) => {
        if (accepts(event)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setOver(true);
        }
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: ReactDragEvent) => {
        if (!accepts(event)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const { folder, items } = readDrop(event);
        if (folder !== undefined && canMoveFolder(state.folders ?? [], folder, target)) {
          void state.moveFolder(folder, target);
        }
        if (items.length > 0) {
          void state.moveItems(itemIdsFor(items), target);
        }
      },
    },
  };
}

export function FolderPath({
  state,
  rootLabel,
  rootIcon,
  itemIdsFor,
}: {
  state: FolderTreeState;
  rootLabel: string;
  rootIcon: ReactNode;
  itemIdsFor: (ids: string[]) => string[];
}) {
  const [naming, setNaming] = useState(false);

  if (state.folders === undefined) {
    return <div className="h-11" aria-hidden="true" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <nav aria-label="Folder path" className="min-w-0 flex-1">
          <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
            <PathSegment
              state={state}
              target={null}
              label={rootLabel}
              icon={rootIcon}
              last={state.path.length === 0}
              itemIdsFor={itemIdsFor}
            />
            {state.path.map((folder, index) => (
              <PathSegment
                key={folder.id}
                state={state}
                target={folder.id}
                label={folderLabel(folder)}
                last={index === state.path.length - 1}
                itemIdsFor={itemIdsFor}
              />
            ))}
          </ol>
        </nav>
        {state.invalid ? null : (
          <Button
            variant="secondary"
            disabled={state.busy || !canCreateIn(state.folders, state.current)}
            title={canCreateIn(state.folders, state.current) ? undefined : 'Folders go at most 8 levels deep'}
            onClick={() => setNaming(true)}
          >
            <FolderPlusIcon className="h-4 w-4 shrink-0" />
            New folder
          </Button>
        )}
      </div>

      {state.invalid ? <Notice tone="warning">{INVALID_TREE_MESSAGE}</Notice> : null}
      {state.message ? <Notice tone="danger">{state.message}</Notice> : null}

      {naming ? (
        <FolderNameDialog
          title="New folder"
          action="Create folder"
          initial=""
          siblings={state.children}
          busy={state.busy}
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            if (await state.create(name)) {
              setNaming(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function PathSegment({
  state,
  target,
  label,
  icon,
  last,
  itemIdsFor,
}: {
  state: FolderTreeState;
  target: string | null;
  label: string;
  icon?: ReactNode;
  last: boolean;
  itemIdsFor: (ids: string[]) => string[];
}) {
  const drop = useDropTarget(state, target, itemIdsFor);

  return (
    <li className="flex min-w-0 items-center gap-0.5">
      {target !== null ? (
        <span aria-hidden="true" className="px-0.5 text-ink-faint">
          /
        </span>
      ) : null}
      <button
        type="button"
        aria-current={last ? 'location' : undefined}
        onClick={() => state.open(target)}
        {...drop.props}
        className={`flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-lg px-2 py-1.5 text-compact font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
          drop.over
            ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-400'
            : last
              ? 'text-ink'
              : 'text-ink-muted hover:bg-raised hover:text-ink'
        }`}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

export function FolderTile({
  state,
  folder,
  nouns,
  glyphPixels,
  frameClass,
  itemIdsFor,
}: {
  state: FolderTreeState;
  folder: TreeFolder;
  nouns: FolderNouns;
  glyphPixels?: number;
  frameClass?: string;
  itemIdsFor: (ids: string[]) => string[];
}) {
  const { fullDevice } = useCryple();
  const drop = useDropTarget(state, folder.id, itemIdsFor);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const label = folderLabel(folder);
  const subfolders = useMemo(
    () => descendantsOf(state.folders ?? [], folder.id).size - 1,
    [state.folders, folder.id],
  );
  const siblings = useMemo(
    () => childrenOf(state.folders ?? [], folder.parentId),
    [state.folders, folder.parentId],
  );

  return (
    <li className="group relative" {...drop.props}>
      <button
        type="button"
        draggable={!state.busy}
        onDragStart={(event) => {
          event.stopPropagation();
          startFolderDrag(event, folder.id);
        }}
        onClick={() => state.open(folder.id)}
        disabled={state.busy}
        aria-label={`Open folder ${label}`}
        className={`flex w-full flex-col items-center gap-1.5 rounded-lg p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-60 ${
          drop.over ? 'bg-brand-50 ring-2 ring-brand-400' : 'hover:bg-raised'
        }`}
      >
        <span
          className={`flex items-end justify-center drop-shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 ${
            frameClass ?? ''
          }`}
          style={glyphPixels === undefined ? undefined : { height: glyphPixels, width: glyphPixels }}
        >
          <span className={glyphPixels === undefined ? 'block w-[78%]' : 'block h-full w-full'}>
            <FolderGlyph open={drop.over} />
          </span>
        </span>
        <span className="block w-full min-w-0">
          <span
            className={`line-clamp-2 block break-words text-compact font-medium ${
              folder.name === undefined ? 'italic text-ink-muted' : 'text-ink'
            }`}
          >
            {label}
          </span>
          <span className="mt-0.5 block truncate text-caption normal-case tracking-normal text-ink-muted">
            {subfolders === 0 ? 'Folder' : `${subfolders} ${subfolders === 1 ? 'folder' : 'folders'} inside`}
          </span>
        </span>
      </button>

      <div className="absolute right-1 top-1 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <TileAction label={`Rename ${label}`} disabled={state.busy} onClick={() => setRenaming(true)}>
          <PencilIcon className="h-3 w-3 shrink-0" />
        </TileAction>
        {fullDevice ? (
          <TileAction label={`Delete ${label}`} danger disabled={state.busy} onClick={() => setDeleting(true)}>
            <TrashIcon className="h-3 w-3 shrink-0" />
          </TileAction>
        ) : null}
      </div>

      {renaming ? (
        <FolderNameDialog
          title={`Rename “${label}”`}
          action="Rename"
          initial={folder.name ?? ''}
          renaming={folder.id}
          siblings={siblings}
          busy={state.busy}
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => {
            if (await state.rename(folder.id, name)) {
              setRenaming(false);
            }
          }}
        />
      ) : null}

      {deleting ? (
        <Modal
          title={`Delete “${label}”`}
          onClose={() => setDeleting(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={state.busy} onClick={() => setDeleting(false)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                disabled={state.busy}
                onClick={() =>
                  void state.remove(folder.id).then((result) => {
                    if (result !== undefined) {
                      setDeleting(false);
                    }
                  })
                }
              >
                <TrashIcon />
                {state.busy ? 'Deleting…' : 'Delete folder and contents'}
              </Button>
            </div>
          }
        >
          <p className="text-compact text-ink-soft">{folderDeleteConfirmation(label, subfolders, nouns)}</p>
        </Modal>
      ) : null}
    </li>
  );
}

function TileAction({
  label,
  danger = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        danger ? 'hover:text-danger' : 'hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  );
}

function FolderNameDialog({
  title,
  action,
  initial,
  renaming,
  siblings,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  action: string;
  initial: string;
  renaming?: string;
  siblings: readonly TreeFolder[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const problem = folderNameProblem(name, siblings, renaming);
  const unchanged = renaming !== undefined && name.trim() === initial.trim();

  return (
    <Modal
      title={title}
      subtitle="The name is encrypted on this device before it is stored."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || problem !== undefined || unchanged} onClick={() => void onSubmit(name)}>
            {action}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && problem === undefined && !unchanged) {
            void onSubmit(name);
          }
        }}
      >
        <Field
          label="Folder name"
          value={name}
          autoComplete="off"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          hint={name.trim() === '' ? undefined : problem}
        />
      </form>
    </Modal>
  );
}

export function MoveToFolder({
  state,
  itemIds,
  rootLabel,
}: {
  state: FolderTreeState;
  itemIds: readonly string[];
  rootLabel: string;
}) {
  const folders = state.folders ?? [];
  if (state.invalid || itemIds.length === 0 || (folders.length === 0 && state.current === null)) {
    return null;
  }

  const flattened: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childrenOf(folders, parentId)) {
      flattened.push({ id: folder.id, label: `${'\u00a0\u00a0'.repeat(depth)}${folderLabel(folder)}` });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <select
      aria-label="Move the selection to a folder"
      title="Move the selection to a folder"
      value=""
      disabled={state.busy}
      onChange={(event) => {
        const target = event.target.value;
        if (target !== '') {
          void state.moveItems(itemIds, target === ROOT_FOLDER ? null : target);
        }
      }}
      className="h-9 max-w-[12rem] cursor-pointer rounded-lg border border-line bg-surface px-2 text-compact font-semibold text-ink-soft shadow-card transition hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50"
    >
      <option value="">Move to…</option>
      {state.current === null ? null : <option value={ROOT_FOLDER}>{rootLabel}</option>}
      {flattened
        .filter((entry) => entry.id !== state.current)
        .map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
    </select>
  );
}
