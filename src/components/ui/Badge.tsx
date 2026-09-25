import type { ReactNode } from 'react';

const BADGE_TONES = {
  neutral: 'border-line bg-raised text-ink-muted',
  brand: 'border-brand-100 bg-brand-50 text-brand-700',
  success: 'border-success-line bg-success-bg text-success',
  warning: 'border-warning-line bg-warning-bg text-warning',
  danger: 'border-danger-line bg-danger-bg text-danger',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption uppercase ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
