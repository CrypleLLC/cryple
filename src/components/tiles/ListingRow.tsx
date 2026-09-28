import type { DragEvent, HTMLAttributes, ReactNode } from 'react';
import { TileCheckbox } from './TileCheckbox';

const LISTING_COLUMNS =
  'grid-cols-[minmax(0,1fr)_6.5rem_4.5rem] @lg:grid-cols-[minmax(0,1fr)_7.5rem_5rem_7rem] @2xl:grid-cols-[minmax(0,1fr)_8rem_5rem_7rem_8.5rem]';

const MODIFIED_CELL = 'hidden @lg:block';
const STATUS_CELL = 'hidden @2xl:block';

export function Listing({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div
        aria-hidden="true"
        className={`grid ${LISTING_COLUMNS} items-center gap-x-4 border-b border-line py-2 pl-9 pr-3 text-caption uppercase text-ink-muted`}
      >
        <span>Name</span>
        <span>Type</span>
        <span>Size</span>
        <span className={MODIFIED_CELL}>Modified</span>
        <span className={STATUS_CELL}>Status</span>
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </div>
  );
}

export interface ListingSelection {
  selecting: boolean;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}

export function ListingRow({
  icon,
  name,
  nameClassName = 'text-ink',
  below,
  type,
  size,
  modified,
  status,
  statusClassName = 'text-ink-muted',
  title,
  openLabel,
  disabled,
  onOpen,
  selection,
  highlighted = false,
  draggable = false,
  onDragStart,
  dropProps,
  actions,
  actionsAlwaysVisible = false,
  selectId,
  children,
}: {
  icon: ReactNode;
  name: string;
  nameClassName?: string;
  below?: ReactNode;
  type: string;
  size: string;
  modified: string;
  status: string;
  statusClassName?: string;
  title?: string;
  openLabel: string;
  disabled: boolean;
  onOpen: () => void;
  selection?: ListingSelection;
  highlighted?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  dropProps?: HTMLAttributes<HTMLLIElement>;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  selectId?: string;
  children?: ReactNode;
}) {
  return (
    <li
      className="group relative"
      draggable={draggable}
      onDragStart={onDragStart}
      data-select-id={selectId}
      {...dropProps}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        title={title}
        aria-label={openLabel}
        className={`grid w-full ${LISTING_COLUMNS} items-center gap-x-4 py-2 pl-9 pr-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 disabled:opacity-60 ${
          highlighted ? 'bg-brand-50 ring-1 ring-inset ring-brand-300' : 'hover:bg-raised'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
          <span className="block min-w-0 flex-1">
            <span className={`block truncate text-compact font-medium ${nameClassName}`}>{name}</span>
            {below}
          </span>
        </span>
        <span className="truncate text-compact text-ink-soft">{type}</span>
        <span className="truncate whitespace-nowrap text-compact tabular-nums text-ink-soft">{size}</span>
        <span className={`${MODIFIED_CELL} truncate whitespace-nowrap text-compact text-ink-soft`}>
          {modified}
        </span>
        <span className={`${STATUS_CELL} truncate text-compact ${statusClassName}`}>{status}</span>
      </button>

      {selection !== undefined ? (
        <TileCheckbox
          name={name}
          selected={selection.selected}
          selecting={selection.selecting}
          disabled={selection.disabled}
          onToggle={selection.onToggle}
          className="left-2 top-1/2 -translate-y-1/2"
        />
      ) : null}

      {actions !== undefined ? (
        <div
          className={`absolute right-2 top-1/2 z-10 flex -translate-y-1/2 gap-1 rounded-md bg-raised pl-2 transition ${
            actionsAlwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          {actions}
        </div>
      ) : null}

      {children}
    </li>
  );
}
