'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CONTENT_GUTTER, contentMeasure, FLOATING_SPREAD_GUTTER, SIDEBAR_INSET } from '@/lib/app';
import { PlusIcon } from './icons';

const BUTTON_VARIANTS = {
  primary:
    'bg-brand-600 text-white shadow-card hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none',
  accent:
    'brand-gradient text-white shadow-raised hover:opacity-95 hover:shadow-lift disabled:opacity-50 disabled:shadow-card',
  secondary:
    'border border-line bg-surface text-ink-soft shadow-card hover:border-line-strong hover:bg-raised hover:text-ink disabled:opacity-50',
  ghost: 'text-ink-muted hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50',
  danger:
    'border border-danger-line bg-surface text-danger shadow-card hover:bg-danger-bg disabled:opacity-50',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-compact font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ground active:scale-[0.99] disabled:pointer-events-none disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

const HINT_PLACEMENTS = {
  below: 'top-full mt-2',
  above: 'bottom-full mb-2',
} as const;

export type HintPlacement = keyof typeof HINT_PLACEMENTS;

const HINTED_TONES = {
  neutral: 'border-line text-ink-soft hover:border-line-strong hover:bg-raised hover:text-ink',
  danger: 'border-danger-line text-danger hover:bg-danger-bg',
} as const;

export const HINTED_ICON_FRAME =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-surface shadow-card transition-all duration-200';

export function HintFrame({
  hint,
  placement = 'below',
  children,
}: {
  hint: string;
  placement?: HintPlacement;
  children: ReactNode;
}) {
  return (
    <span className="group/hint relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-caption normal-case tracking-normal text-white opacity-0 shadow-raised transition-opacity duration-150 group-hover/hint:opacity-100 group-has-[:focus-visible]/hint:opacity-100 ${HINT_PLACEMENTS[placement]}`}
      >
        {hint}
      </span>
    </span>
  );
}

export function HintedIconButton({
  hint,
  placement,
  tone = 'neutral',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  hint: string;
  placement?: HintPlacement;
  tone?: keyof typeof HINTED_TONES;
}) {
  return (
    <HintFrame hint={hint} placement={placement}>
      <button
        type="button"
        aria-label={hint}
        className={`${HINTED_ICON_FRAME} ${HINTED_TONES[tone]} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </button>
    </HintFrame>
  );
}

export function FloatingAddButton({
  label,
  spread = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; spread?: boolean }) {
  const frame = spread
    ? `${contentMeasure(true)} ${FLOATING_SPREAD_GUTTER}`
    : `${contentMeasure(false)} ${CONTENT_GUTTER}`;

  return (
    <div className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 ${SIDEBAR_INSET}`}>
      <div className={`mx-auto flex w-full justify-end ${frame}`}>
        <button
          type="button"
          title={label}
          aria-label={label}
          className={`brand-gradient pointer-events-auto mb-6 inline-flex h-14 w-14 cursor-pointer items-center justify-center rounded-full text-white shadow-lift transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ground disabled:pointer-events-none disabled:cursor-default disabled:opacity-50 disabled:shadow-card ${className}`}
          {...props}
        >
          <PlusIcon className="h-6 w-6 shrink-0" />
        </button>
      </div>
    </div>
  );
}
