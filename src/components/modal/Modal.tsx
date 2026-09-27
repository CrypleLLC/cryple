'use client';

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { FOCUSABLE_SELECTOR, isBackdropDismissal, scrollLockTransition, trapAction } from '@/lib/app';
import { IconButton } from '@/components/ui';
import { CloseIcon } from '@/components/ui/icons';

export function Modal({
  title,
  subtitle,
  onClose,
  footer,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
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
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lift outline-none ${
          wide ? 'max-w-4xl' : 'max-w-2xl'
        }`}
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
