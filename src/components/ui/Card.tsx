import type { ReactNode } from 'react';

export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-8 md:grid-cols-2">{children}</div>;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      {title || subtitle || actions ? (
        <header className="flex items-start justify-between gap-4 pb-4">
          <div className="min-w-0">
            {title ? <h2 className="text-title text-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-1 text-compact text-ink-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}
