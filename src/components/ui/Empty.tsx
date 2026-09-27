import type { ReactNode } from 'react';

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
