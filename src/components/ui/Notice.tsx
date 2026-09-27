import type { ReactNode } from 'react';
import { CloseIcon } from './icons';

const NOTICE_TONES = {
  info: 'border-brand-100 bg-brand-50 text-brand-800',
  warning: 'border-warning-line bg-warning-bg text-warning',
  danger: 'border-danger-line bg-danger-bg text-danger',
  success: 'border-success-line bg-success-bg text-success',
} as const;

export type NoticeTone = keyof typeof NOTICE_TONES;

export function Notice({
  tone = 'info',
  onDismiss,
  children,
}: {
  tone?: NoticeTone;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  if (onDismiss === undefined) {
    return (
      <div className={`rounded-xl border px-4 py-3 text-compact ${NOTICE_TONES[tone]}`}>{children}</div>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-xl border py-3 pl-4 pr-2 text-compact ${NOTICE_TONES[tone]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="-my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-70 transition hover:bg-ink/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <CloseIcon className="h-4 w-4 shrink-0" />
      </button>
    </div>
  );
}
