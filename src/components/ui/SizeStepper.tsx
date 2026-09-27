'use client';

import {
  iconScale,
  isLargestIconSize,
  isSmallestIconSize,
  largerIconSize,
  smallerIconSize,
  type IconSize,
} from '@/lib/app';
import { MinusIcon, PlusIcon } from './icons';

const STEP_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:pointer-events-none disabled:opacity-40';

export function SizeStepper({
  size,
  onChange,
  smallerLabel,
  largerLabel,
  groupLabel,
}: {
  size: IconSize;
  onChange: (size: IconSize) => void;
  smallerLabel: string;
  largerLabel: string;
  groupLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-card"
    >
      <button
        type="button"
        aria-label={smallerLabel}
        title={smallerLabel}
        disabled={isSmallestIconSize(size)}
        onClick={() => onChange(smallerIconSize(size))}
        className={STEP_CLASS}
      >
        <MinusIcon className="h-4 w-4 shrink-0" />
      </button>
      <span
        aria-live="polite"
        className="w-20 text-center text-caption normal-case tracking-normal text-ink-muted"
      >
        {iconScale(size).label}
      </span>
      <button
        type="button"
        aria-label={largerLabel}
        title={largerLabel}
        disabled={isLargestIconSize(size)}
        onClick={() => onChange(largerIconSize(size))}
        className={STEP_CLASS}
      >
        <PlusIcon className="h-4 w-4 shrink-0" />
      </button>
    </div>
  );
}
