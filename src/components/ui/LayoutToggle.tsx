'use client';

import type { ComponentType } from 'react';
import type { ItemLayout } from '@/lib/app';
import { GridIcon, ListIcon, type IconProps } from './icons';

const LAYOUT_CHOICES: readonly { layout: ItemLayout; label: string; Glyph: ComponentType<IconProps> }[] = [
  { layout: 'grid', label: 'Show as a grid', Glyph: GridIcon },
  { layout: 'list', label: 'Show as a list with details', Glyph: ListIcon },
];

export function LayoutToggle({
  layout,
  onChange,
}: {
  layout: ItemLayout;
  onChange: (layout: ItemLayout) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-card"
    >
      {LAYOUT_CHOICES.map(({ layout: choice, label, Glyph }) => (
        <button
          key={choice}
          type="button"
          aria-label={label}
          aria-pressed={layout === choice}
          title={label}
          onClick={() => onChange(choice)}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
            layout === choice
              ? 'bg-brand-50 text-brand-700'
              : 'text-ink-muted hover:bg-brand-50 hover:text-brand-700'
          }`}
        >
          <Glyph className="h-4 w-4 shrink-0" />
        </button>
      ))}
    </div>
  );
}
