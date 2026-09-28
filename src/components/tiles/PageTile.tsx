import type { ComponentType, DragEvent, ReactNode } from 'react';
import { SharingIcon } from '@/components/ui/icons';
import { TileAction } from './TileAction';
import { TileCheckbox } from './TileCheckbox';

export function PageTile({
  title,
  caption,
  hint,
  aspectClass,
  readable,
  unreadableIcon: UnreadableIcon,
  selecting,
  selected,
  busy,
  onOpen,
  onShare,
  onToggle,
  onDragStart,
  pageWidth,
  selectId,
  labelClass = 'text-compact',
  children,
}: {
  title: string;
  caption?: string;
  hint?: string;
  aspectClass: string;
  readable: boolean;
  unreadableIcon: ComponentType<{ className?: string }>;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onShare: () => void;
  onToggle: () => void;
  onDragStart: (event: DragEvent) => void;
  pageWidth?: number;
  selectId?: string;
  labelClass?: string;
  children: ReactNode;
}) {
  const iconSized = pageWidth !== undefined;

  return (
    <li className="group relative" draggable={!busy} onDragStart={onDragStart} data-select-id={selectId}>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        title={hint}
        aria-label={selecting ? `${selected ? 'Deselect' : 'Select'} ${title}` : title}
        className={`flex w-full flex-col transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-60 ${
          iconSized
            ? 'items-center gap-1.5 rounded-lg p-2 text-center hover:bg-raised'
            : 'gap-2.5 rounded-xl p-1 text-left'
        }`}
      >
        <span
          style={iconSized ? { width: pageWidth } : undefined}
          className={`relative block ${aspectClass} overflow-hidden bg-surface shadow-card transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lift ${
            iconSized ? 'rounded-md' : 'w-full rounded-xl'
          } ${selected ? 'ring-2 ring-brand-500' : 'ring-1 ring-line group-hover:ring-brand-200'}`}
        >
          {readable ? (
            children
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <UnreadableIcon className="h-[22%] w-[22%] text-ink-faint" />
            </span>
          )}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[18%] bg-gradient-to-t from-surface to-transparent" />
        </span>

        <span className="block w-full min-w-0 px-0.5">
          <span
            className={`block ${labelClass} text-ink ${
              iconSized ? 'line-clamp-2 break-words font-medium' : 'truncate font-semibold'
            }`}
          >
            {title}
          </span>
          {caption !== undefined ? (
            <span className="mt-0.5 block truncate text-caption normal-case tracking-normal text-ink-muted">
              {caption}
            </span>
          ) : null}
        </span>
      </button>

      <TileCheckbox
        name={title}
        selected={selected}
        selecting={selecting}
        disabled={busy}
        onToggle={onToggle}
        className={iconSized ? 'left-1 top-1' : 'left-3 top-3'}
      />

      <TileAction
        label={`Share ${title}`}
        disabled={busy || !readable}
        onClick={onShare}
        className={`absolute z-10 ${iconSized ? 'right-1 top-1' : 'right-3 top-3'} ${
          selecting ? 'opacity-0' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        <SharingIcon className="h-3 w-3 shrink-0" />
      </TileAction>
    </li>
  );
}
