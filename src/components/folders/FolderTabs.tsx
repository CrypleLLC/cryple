'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  createFolder,
  deleteFolder,
  editFolders,
  FolderManifestInvalidError,
  forgetItems,
  loadFolders,
  MANIFEST_SCOPE_RULES,
  placeItem,
  renameFolder,
  resetFolders,
  type FolderEdit,
  type FolderManifest,
  type FolderManifestProblem,
  type ManifestScope,
} from '@/lib/folders';
import {
  activeTabOf,
  buildFolderTabs,
  countOf,
  invalidTabsMessage,
  itemsInTab,
  PRIVATE_TEXT_PROPS,
  tabDeleteConfirmation,
  tabDeleteRefusal,
  tabNameProblem,
  type FolderNouns,
  type FolderTab,
} from '@/lib/app';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';
import { FolderIcon, FolderPlusIcon, PencilIcon, TrashIcon } from '@/components/ui/icons';
import { Button, HINTED_ICON_FRAME, HintFrame, Notice, type HintPlacement } from '@/components/ui';
import { ConfirmDeleteModal } from '@/components/modal';
import { ScreenStrip } from '@/components/shell/ScreenStrip';

export const DRAGGED_ITEMS_TYPE = 'application/x-zekke-items';

export function startItemDrag(event: ReactDragEvent, ids: readonly string[], badge?: string) {
  event.dataTransfer.setData(DRAGGED_ITEMS_TYPE, JSON.stringify(ids));
  event.dataTransfer.effectAllowed = 'move';
  if (badge !== undefined) {
    showDragBadge(event, badge);
  }
}

function showDragBadge(event: ReactDragEvent, text: string) {
  const badge = document.createElement('div');
  badge.textContent = text;
  badge.className =
    'fixed -left-[1000px] top-0 rounded-full bg-brand-600 px-3 py-1.5 text-compact font-semibold text-white shadow-raised';
  document.body.appendChild(badge);
  event.dataTransfer.setDragImage(badge, 12, 12);
  requestAnimationFrame(() => badge.remove());
}

function draggedItems(event: ReactDragEvent): string[] {
  try {
    const parsed: unknown = JSON.parse(event.dataTransfer.getData(DRAGGED_ITEMS_TYPE));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export interface FolderTabsState {
  tabs: FolderTab[] | undefined;
  active: string;
  select: (id: string) => void;
  invalid: FolderManifestProblem | undefined;
  message: string | undefined;
  dismissMessage: () => void;
  busy: boolean;
  filter: <T>(items: readonly T[], idOf: (item: T) => string) => T[];
  create: (name: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (tab: FolderTab, deleteItems: (ids: string[]) => Promise<void>) => Promise<boolean>;
  move: (itemIds: readonly string[], tabId: string) => Promise<void>;
  file: (itemId: string) => Promise<void>;
  forget: (itemIds: readonly string[]) => Promise<void>;
  reset: () => Promise<void>;
}

export function useFolderTabs(scope: ManifestScope, itemIds: readonly string[] | undefined): FolderTabsState {
  const context = useAuthedContext();
  const { reportError } = useZekke();
  const rules = MANIFEST_SCOPE_RULES[scope];

  const [manifest, setManifest] = useState<FolderManifest>();
  const [invalid, setInvalid] = useState<FolderManifestProblem>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wanted, setWanted] = useState<string>();

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof FolderManifestInvalidError) {
        setInvalid(error.problem);
        setManifest(undefined);
        return;
      }
      setMessage(reportError(error));
    },
    [reportError],
  );

  useEffect(() => {
    let live = true;
    loadFolders(context, scope)
      .then((loaded) => {
        if (live) {
          setManifest(loaded);
          setInvalid(undefined);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          fail(error);
        }
      });
    return () => {
      live = false;
    };
  }, [context, scope, fail]);

  const tabs = useMemo(
    () => (manifest === undefined || itemIds === undefined ? undefined : buildFolderTabs(manifest, itemIds, rules)),
    [manifest, itemIds, rules],
  );
  const active = activeTabOf(tabs ?? [], wanted);

  const apply = useCallback(
    async (edit: FolderEdit): Promise<boolean> => {
      setBusy(true);
      try {
        setManifest(await editFolders(context, scope, edit));
        setMessage(undefined);
        return true;
      } catch (error) {
        fail(error);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [context, scope, fail],
  );

  const filter = useCallback(
    <T,>(items: readonly T[], idOf: (item: T) => string): T[] =>
      manifest === undefined ? [...items] : itemsInTab(manifest, active, items, idOf, rules),
    [manifest, active, rules],
  );

  const create = useCallback(
    async (name: string) => {
      const id = crypto.randomUUID();
      const created = await apply(createFolder({ id, name }));
      if (created) {
        setWanted(id);
      }
      return created;
    },
    [apply],
  );

  const rename = useCallback((id: string, name: string) => apply(renameFolder(id, name)), [apply]);

  const remove = useCallback(
    async (tab: FolderTab, deleteItems: (ids: string[]) => Promise<void>) => {
      if (manifest === undefined || itemIds === undefined) {
        return false;
      }
      const contained = itemsInTab(manifest, tab.id, itemIds, (id) => id, rules);
      setBusy(true);
      try {
        if (contained.length > 0) {
          await deleteItems(contained);
        }
      } catch (error) {
        setBusy(false);
        fail(error);
        return false;
      }
      const removed = await apply((current, currentRules) =>
        forgetItems(contained)(deleteFolder(tab.id)(current, currentRules), currentRules),
      );
      if (removed) {
        setWanted(undefined);
      }
      return removed;
    },
    [apply, fail, itemIds, manifest, rules],
  );

  const move = useCallback(
    async (ids: readonly string[], tabId: string) => {
      await apply((current, currentRules) =>
        ids.reduce((next, id) => placeItem(id, tabId)(next, currentRules), current),
      );
    },
    [apply],
  );

  const file = useCallback(
    async (itemId: string) => {
      await apply(placeItem(itemId, active));
    },
    [apply, active],
  );

  const forget = useCallback((ids: readonly string[]) => apply(forgetItems(ids)).then(() => undefined), [apply]);

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      setManifest(await resetFolders(context, scope));
      setInvalid(undefined);
      setWanted(undefined);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }, [context, scope, reportError]);

  return {
    tabs,
    active,
    select: setWanted,
    invalid,
    message,
    dismissMessage: () => setMessage(undefined),
    busy,
    filter,
    create,
    rename,
    remove,
    move,
    file,
    forget,
    reset,
  };
}

export default function FolderTabs({
  state,
  nouns,
  label,
  deleteItems,
}: {
  state: FolderTabsState;
  nouns: FolderNouns;
  label: string;
  deleteItems: (ids: string[]) => Promise<void>;
}) {
  const { fullDevice } = useZekke();
  const { tabs, active, busy } = state;
  const [naming, setNaming] = useState<{ id?: string; name: string }>();
  const [deleting, setDeleting] = useState<FolderTab>();
  const [dropTarget, setDropTarget] = useState<string>();

  if (state.invalid !== undefined) {
    return (
      <Notice tone="warning">
        <p>{invalidTabsMessage(state.invalid)}</p>
        <div className="mt-3">
          <Button variant="secondary" disabled={busy} onClick={() => void state.reset()}>
            Reset the tabs
          </Button>
        </div>
      </Notice>
    );
  }

  if (tabs === undefined) {
    return (
      <ScreenStrip>
        <div className="h-10 border-b border-line bg-surface/90 backdrop-blur" aria-hidden="true" />
      </ScreenStrip>
    );
  }

  const problem = naming === undefined ? undefined : tabNameProblem(naming.name, tabs, naming.id);
  const refusal = deleting === undefined ? undefined : tabDeleteRefusal(deleting, fullDevice, nouns);

  async function commitName() {
    if (naming === undefined || problem !== undefined) {
      return;
    }
    const done = naming.id === undefined ? await state.create(naming.name) : await state.rename(naming.id, naming.name);
    if (done) {
      setNaming(undefined);
    }
  }

  function onNameKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitName();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setNaming(undefined);
    }
  }

  function dropProps(tab: FolderTab) {
    return {
      onDragOver: (event: ReactDragEvent) => {
        if (event.dataTransfer.types.includes(DRAGGED_ITEMS_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropTarget(tab.id);
        }
      },
      onDragLeave: () => setDropTarget((current) => (current === tab.id ? undefined : current)),
      onDrop: (event: ReactDragEvent) => {
        event.preventDefault();
        setDropTarget(undefined);
        const ids = draggedItems(event);
        if (ids.length > 0) {
          void state.move(ids, tab.id);
        }
      },
    };
  }

  const problemShown = naming !== undefined && problem !== undefined && naming.name.trim() !== '';

  return (
    <>
      <ScreenStrip>
        <div className="relative bg-surface/90 backdrop-blur">
          <div className="absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden="true" />
          <div role="tablist" aria-label={label} className="relative flex h-10 items-stretch overflow-x-auto">
            {tabs.map((tab) =>
              naming?.id === tab.id ? (
                <TabNameInput
                  key={tab.id}
                  value={naming.name}
                  label={`Rename ${tab.name}`}
                  onChange={(name) => setNaming({ id: tab.id, name })}
                  onKeyDown={onNameKey}
                  onBlur={() => void commitName()}
                />
              ) : (
                <FolderTabButton
                  key={tab.id}
                  tab={tab}
                  nouns={nouns}
                  selected={tab.id === active}
                  dropping={dropTarget === tab.id}
                  busy={busy}
                  onSelect={() => state.select(tab.id)}
                  onRename={() => setNaming({ id: tab.id, name: tab.name })}
                  onDelete={tab.home ? undefined : () => setDeleting(tab)}
                  {...dropProps(tab)}
                />
              ),
            )}

            {naming !== undefined && naming.id === undefined ? (
              <TabNameInput
                value={naming.name}
                label="New tab name"
                onChange={(name) => setNaming({ name })}
                onKeyDown={onNameKey}
                onBlur={() => (naming.name.trim() === '' ? setNaming(undefined) : void commitName())}
              />
            ) : (
              <button
                type="button"
                title="New tab"
                aria-label="New tab"
                disabled={busy}
                onClick={() => setNaming({ name: '' })}
                className="flex w-10 shrink-0 items-center justify-center text-ink-muted transition-colors hover:bg-raised hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 disabled:opacity-50"
              >
                <FolderPlusIcon className="h-4.5 w-4.5 shrink-0" />
              </button>
            )}
          </div>
        </div>
      </ScreenStrip>

      {problemShown || state.message ? (
        <div className="space-y-3">
          {problemShown ? (
            <p className="text-compact text-danger" role="alert">
              {problem}
            </p>
          ) : null}
          {state.message ? (
            <Notice tone="danger" onDismiss={state.dismissMessage}>
              {state.message}
            </Notice>
          ) : null}
        </div>
      ) : null}

      {deleting !== undefined ? (
        <ConfirmDeleteModal
          title={`Delete “${deleting.name}”`}
          subtitle={countOf(deleting.count, nouns)}
          busy={busy}
          confirmLabel={
            busy ? 'Deleting…' : deleting.count > 0 ? `Delete tab and ${countOf(deleting.count, nouns)}` : 'Delete tab'
          }
          onKeep={() => setDeleting(undefined)}
          onConfirm={
            refusal === undefined
              ? () =>
                  void state.remove(deleting, deleteItems).then((done) => {
                    if (done) {
                      setDeleting(undefined);
                    }
                  })
              : undefined
          }
        >
          {refusal ?? tabDeleteConfirmation(deleting, nouns)}
        </ConfirmDeleteModal>
      ) : null}
    </>
  );
}

function FolderTabButton({
  tab,
  nouns,
  selected,
  dropping,
  busy,
  onSelect,
  onRename,
  onDelete,
  ...drop
}: {
  tab: FolderTab;
  nouns: FolderNouns;
  selected: boolean;
  dropping: boolean;
  busy: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete?: () => void;
  onDragOver: (event: ReactDragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: ReactDragEvent) => void;
}) {
  const shape = selected
    ? 'bg-ground text-ink before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-brand-500'
    : 'text-ink-muted hover:bg-raised hover:text-ink';

  return (
    <div
      className={`group relative flex shrink-0 items-center border-r border-line transition-colors ${shape} ${
        dropping ? 'bg-brand-50 text-brand-700 ring-2 ring-inset ring-brand-400' : ''
      }`}
      {...drop}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        title={countOf(tab.count, nouns)}
        onClick={onSelect}
        onDoubleClick={onRename}
        className="flex h-full max-w-[14rem] items-center gap-2 pl-3.5 pr-2 text-compact font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50"
      >
        <FolderIcon className={`h-4 w-4 shrink-0 ${selected ? 'text-brand-500' : 'text-ink-faint'}`} />
        <span className="truncate">{tab.name}</span>
        <span
          className={`rounded-full px-1.5 text-caption normal-case tracking-normal ${
            selected ? 'bg-brand-50 text-brand-700' : 'bg-line/60 text-ink-muted'
          }`}
        >
          {tab.count}
        </span>
      </button>
      <span className={`flex items-center pr-1.5 ${selected ? '' : 'hidden group-hover:flex group-focus-within:flex'}`}>
        <button
          type="button"
          title={`Rename ${tab.name}`}
          aria-label={`Rename ${tab.name}`}
          disabled={busy}
          onClick={onRename}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <PencilIcon className="h-3.5 w-3.5 shrink-0" />
        </button>
        {onDelete ? (
          <button
            type="button"
            title={`Delete ${tab.name}`}
            aria-label={`Delete ${tab.name}`}
            disabled={busy}
            onClick={onDelete}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <TrashIcon className="h-3.5 w-3.5 shrink-0" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

function TabNameInput({
  value,
  label,
  onChange,
  onKeyDown,
  onBlur,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <div className="relative flex shrink-0 items-center gap-2 border-r border-line bg-ground pl-3.5 pr-2 ring-2 ring-inset ring-brand-300">
      <FolderIcon className="h-4 w-4 shrink-0 text-brand-500" />
      <input
        ref={input}
        {...PRIVATE_TEXT_PROPS}
        aria-label={label}
        value={value}
        autoComplete="off"
        maxLength={120}
        placeholder="Tab name"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="w-36 bg-transparent text-compact font-semibold text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}

export const MOVE_TO_TAB_HINT = 'Move to another tab';

export function MoveToTab({
  state,
  itemIds,
  label,
  iconOnly = false,
  hintPlacement,
}: {
  state: FolderTabsState;
  itemIds: readonly string[];
  label: string;
  iconOnly?: boolean;
  hintPlacement?: HintPlacement;
}) {
  const tabs = state.tabs;
  if (tabs === undefined || tabs.length < 2 || itemIds.length === 0) {
    return null;
  }

  const select = (
    <select
      aria-label={label}
      title={iconOnly ? undefined : label}
      value=""
      disabled={state.busy}
      onChange={(event) => {
        if (event.target.value !== '') {
          void state.move(itemIds, event.target.value);
        }
      }}
      className={
        iconOnly
          ? 'absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default'
          : 'h-9 max-w-[10rem] cursor-pointer rounded-lg border border-line bg-surface px-2 text-compact font-semibold text-ink-soft shadow-card transition hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50'
      }
    >
      <option value="">Move to…</option>
      {tabs
        .filter((tab) => tab.id !== state.active)
        .map((tab) => (
          <option key={tab.id} value={tab.id}>
            {tab.name}
          </option>
        ))}
    </select>
  );

  if (!iconOnly) {
    return select;
  }

  return (
    <HintFrame hint={MOVE_TO_TAB_HINT} placement={hintPlacement}>
      <span
        className={`${HINTED_ICON_FRAME} relative border-line text-ink-soft hover:border-line-strong hover:bg-raised hover:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/50 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ground has-[:disabled]:opacity-50`}
      >
        <FolderIcon className="h-4 w-4 shrink-0" />
        {select}
      </span>
    </HintFrame>
  );
}
