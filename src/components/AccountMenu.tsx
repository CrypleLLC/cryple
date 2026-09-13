'use client';

import { useEffect, useRef, useState } from 'react';
import { accountInitial, ACCOUNT_MENU_COPY, type SessionExit } from '@/lib/app';
import { LogOutIcon, SecurityIcon } from './icons';

export default function AccountMenu({
  username,
  logOut,
  onSettings,
  onLogOut,
}: {
  username: string | undefined;
  logOut: SessionExit;
  onSettings: () => void;
  onLogOut: (exit: SessionExit) => void;
}) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (!holder.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={holder} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ACCOUNT_MENU_COPY.open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-raised py-1.5 pl-1.5 pr-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <span className="brand-gradient flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold text-white">
          {accountInitial(username)}
        </span>
        <span className="hidden min-w-0 lg:block">
          <span className="block truncate text-compact font-semibold text-ink">{username}</span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-compact font-semibold text-ink-soft transition-colors hover:bg-raised hover:text-ink"
          >
            <SecurityIcon className="h-4 w-4 shrink-0 text-ink-muted" />
            {ACCOUNT_MENU_COPY.settings}
          </button>
          <button
            type="button"
            role="menuitem"
            title={logOut.description}
            onClick={() => {
              setOpen(false);
              onLogOut(logOut);
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 border-t border-line px-3 py-2.5 text-left text-compact font-semibold text-danger transition-colors hover:bg-danger-bg"
          >
            <LogOutIcon className="h-4 w-4 shrink-0" />
            {logOut.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}
