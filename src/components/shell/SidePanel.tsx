'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/components/ui/icons';

const DESKTOP_QUERY = '(min-width: 48rem)';

export const SIDE_PANEL_TRIGGER = { 'data-side-panel-trigger': '' } as const;

const SidePanelSlotContext = createContext<HTMLElement | null>(null);

export const SidePanelSlotProvider = SidePanelSlotContext.Provider;

export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const slot = useContext(SidePanelSlotContext);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || panel.current?.contains(target)) {
        return;
      }
      if (target.closest('[data-side-panel-trigger]') === null) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      return;
    }
    closeButton.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  if (slot === null) {
    return null;
  }

  return createPortal(
    <div className="fixed top-[var(--staging-banner-h)] right-0 bottom-0 left-0 z-40 flex justify-end md:sticky md:right-auto md:bottom-auto md:left-auto md:z-auto md:h-[calc(100vh-var(--staging-banner-h))] md:shrink-0">
      <button
        type="button"
        aria-label={`Close ${title}`}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm md:hidden"
      />
      <aside
        ref={panel}
        aria-label={title}
        className="relative flex h-full w-80 max-w-[85vw] flex-col border-l border-line bg-surface shadow-card motion-safe:animate-slide-in-right md:max-w-none md:shadow-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-title text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-compact text-ink-muted">{subtitle}</p> : null}
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="-mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <CloseIcon className="h-5 w-5 shrink-0" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    slot,
  );
}

export function PanelFacts({ facts }: { facts: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="space-y-4">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-caption text-ink-faint uppercase">{fact.label}</dt>
          <dd className="mt-1 text-compact break-words text-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
