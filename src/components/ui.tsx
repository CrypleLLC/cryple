'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import {
  FOCUSABLE_SELECTOR,
  isBackdropDismissal,
  scrollLockTransition,
  trapAction,
} from '@/lib/app';
import { CheckIcon, ClipboardIcon, CloseIcon } from './icons';

export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 md:grid-cols-2">{children}</div>;
}

export function Card({
  title,
  subtitle,
  flush = false,
  children,
}: {
  title?: string;
  subtitle?: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      {title || subtitle ? (
        <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          {title ? (
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          ) : null}
          {subtitle ? (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          ) : null}
        </header>
      ) : null}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

const BUTTON_VARIANTS = {
  primary:
    'bg-brand-500 text-white shadow-sm hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 dark:disabled:bg-brand-900 dark:disabled:text-slate-500',
  secondary:
    'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100',
  danger:
    'border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
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
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={copied ? copiedLabel : label}
      className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${className}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <ClipboardIcon />}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500';

const LABEL_CLASS = 'text-sm font-medium text-slate-700 dark:text-slate-300';

const HINT_CLASS = 'mt-1.5 block text-xs text-slate-500 dark:text-slate-400';

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

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'brand';
  children: ReactNode;
}) {
  const styles = {
    neutral:
      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    brand:
      'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
}) {
  const styles = {
    info: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
    danger:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  }[tone];

  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
      {children}
    </p>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
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
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl outline-none dark:border-slate-800 dark:bg-slate-950"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2
              id={titleId}
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
            {footer}
          </footer>
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
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500 dark:border-slate-700 dark:border-t-brand-400" />
    </div>
  );
}
