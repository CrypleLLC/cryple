'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import {
  FOCUSABLE_SELECTOR,
  iconScale,
  isBackdropDismissal,
  isLargestIconSize,
  isSmallestIconSize,
  largerIconSize,
  scrollLockTransition,
  smallerIconSize,
  trapAction,
  type IconSize,
} from '@/lib/app';
import { CheckIcon, ClipboardIcon, CloseIcon, MinusIcon, PlusIcon } from './icons';

export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 md:grid-cols-2">{children}</div>;
}

export function Card({
  title,
  subtitle,
  actions,
  flush = false,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {title || subtitle || actions ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="text-title text-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-1 text-compact text-ink-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? 'min-w-0 flex-1' : 'min-w-0 flex-1 p-5'}>{children}</div>
    </section>
  );
}

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

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  disabled = false,
  className = '',
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      title={label}
      aria-label={copied ? copiedLabel : label}
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckIcon className="h-4 w-4 shrink-0 text-success" /> : <ClipboardIcon />}
      <span>{copied ? copiedLabel : label}</span>
    </Button>
  );
}

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-all placeholder:text-ink-faint focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-raised disabled:text-ink-muted';

const LABEL_CLASS = 'text-compact font-semibold text-ink-soft';

const HINT_CLASS = 'mt-1.5 block text-compact text-ink-muted';

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <input className={INPUT_CLASS} {...props} />
      {hint ? <span className={HINT_CLASS}>{hint}</span> : null}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <textarea className={`${INPUT_CLASS} h-28 resize-y font-mono ${className}`} {...props} />
      {hint ? <span className={HINT_CLASS}>{hint}</span> : null}
    </label>
  );
}

export interface SelectChoice {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  label,
  hint,
  choices,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  choices: readonly SelectChoice[];
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <select className={INPUT_CLASS} {...props}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value} disabled={choice.disabled}>
            {choice.label}
          </option>
        ))}
      </select>
      {hint ? <span className={HINT_CLASS}>{hint}</span> : null}
    </label>
  );
}

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

const NOTICE_TONES = {
  info: 'border-brand-100 bg-brand-50 text-brand-800',
  warning: 'border-warning-line bg-warning-bg text-warning',
  danger: 'border-danger-line bg-danger-bg text-danger',
  success: 'border-success-line bg-success-bg text-success',
} as const;

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof NOTICE_TONES;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-compact ${NOTICE_TONES[tone]}`}>
      {children}
    </div>
  );
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      {icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
          {icon}
        </span>
      ) : null}
      <p className="max-w-sm text-compact text-ink-muted">{children}</p>
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;

    if (scrollLockTransition(openModals, 1) === 'lock') {
      document.body.style.overflow = 'hidden';
    }
    openModals += 1;

    // Focus the first control, or the dialog itself when it has none — either way
    // the next Tab starts inside, and a screen reader announces the dialog rather
    // than whatever was behind it.
    const first = tabbables(dialog.current)[0] ?? dialog.current;
    first?.focus();

    return () => {
      openModals -= 1;
      if (scrollLockTransition(openModals + 1, -1) === 'unlock') {
        document.body.style.overflow = '';
      }
      trigger?.focus();
    };
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const elements = tabbables(dialog.current);
    const action = trapAction(event, {
      count: elements.length,
      active: elements.indexOf(document.activeElement as HTMLElement),
    });

    if (action.kind === 'pass') {
      return;
    }

    event.preventDefault();

    if (action.kind === 'close') {
      onClose();
    }
    if (action.kind === 'focus') {
      elements[action.index]?.focus();
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (isBackdropDismissal(pressedOnBackdrop.current, event.target === event.currentTarget)) {
          onClose();
        }
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lift outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-headline text-ink">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-compact text-ink-muted">{subtitle}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="shrink-0 border-t border-line bg-raised px-5 py-4">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

let openModals = 0;

function tabbables(root: HTMLElement | null): HTMLElement[] {
  return root === null ? [] : Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-100 border-t-brand-500" />
    </div>
  );
}

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
