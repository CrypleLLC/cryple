import type { ReactNode } from 'react';

const HOVER_TONES = {
  brand: 'hover:text-brand-700',
  danger: 'hover:text-danger',
  neutral: 'hover:text-ink',
} as const;

export function TileAction({
  label,
  title = label,
  tone = 'brand',
  disabled = false,
  onClick,
  className = '',
  children,
}: {
  label: string;
  title?: string;
  tone?: keyof typeof HOVER_TONES;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${HOVER_TONES[tone]} ${className}`}
    >
      {children}
    </button>
  );
}
