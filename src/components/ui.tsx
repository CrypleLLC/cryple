'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      {title ? (
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      ) : null}
      {subtitle ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
      ) : null}
      <div className={title || subtitle ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary:
      'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
    secondary:
      'border border-slate-300 text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
    danger: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300',
  }[variant];

  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        {...props}
      />
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
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
    info: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    warning:
      'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
    danger:
      'border-red-400 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
    success:
      'border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  }[tone];

  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
      {children}
    </p>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-slate-100" />
    </div>
  );
}
