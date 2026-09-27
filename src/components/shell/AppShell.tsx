'use client';

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import type { Scope } from '@/lib/scopes';
import {
  contentMeasure,
  sessionExits,
  type SessionExit,
  type SessionExitId,
  lockExit,
  removeBrowserExit,
} from '@/lib/app';
import { useCryple } from '@/components/session/CrypleProvider';
import NotesScreen from '@/components/notes/NotesScreen';
import PasswordsScreen from '@/components/passwords/PasswordsScreen';
import AccountMenu from './AccountMenu';
import SharedScreen from '@/components/sharing/SharedScreen';
import SettingsModal from '@/components/settings/SettingsModal';
import VaultScreen from '@/components/vault/VaultScreen';
import { VaultRevealAction, VaultRevealProvider } from '@/components/vault/VaultReveal';
import {
  DocumentsIcon,
  DriveIcon,
  LockSessionIcon,
  LogOutIcon,
  MenuIcon,
  CloseIcon,
  NotesIcon,
  PasswordsIcon,
  VaultIcon,
  type IconProps,
  SharingIcon,
} from '@/components/ui/icons';
import StorageMeter from './StorageMeter';
import { ScreenStripSlotProvider } from './ScreenStrip';
import { SidePanelSlotProvider } from './SidePanel';
import { Button, Notice, Spinner } from '@/components/ui';

const DocumentsScreen = dynamic(() => import('@/components/documents/DocumentsScreen'), {
  loading: () => <Spinner />,
});

const DriveScreen = dynamic(() => import('@/components/drive/DriveScreen'), {
  loading: () => <Spinner />,
});

interface NavItem {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<IconProps>;
  screen: ComponentType;
  actions?: ComponentType;
  miniatures?: boolean;
  scope?: Scope;
}

const NAV_ITEMS = [
  {
    id: 'vault',
    scope: 'secrets',
    label: 'Vault',
    description: 'Everything stored under your account.',
    icon: VaultIcon,
    screen: VaultScreen,
    actions: VaultRevealAction,
  },
  {
    id: 'passwords',
    scope: 'passwords',
    label: 'Passwords',
    description: 'Website logins, encrypted here and never looked up by the server.',
    icon: PasswordsIcon,
    screen: PasswordsScreen,
    actions: VaultRevealAction,
  },
  {
    id: 'notes',
    scope: 'notes',
    label: 'Notes',
    description: 'Letters and instructions you write, encrypted before they leave this device.',
    icon: NotesIcon,
    screen: NotesScreen,
    miniatures: true,
  },
  {
    id: 'documents',
    scope: 'documents',
    label: 'Documents',
    description: 'Long-form writing, encrypted here and synced across your devices.',
    icon: DocumentsIcon,
    screen: DocumentsScreen,
    miniatures: true,
  },
  {
    id: 'drive',
    scope: 'files',
    label: 'Drive',
    description: 'Files, encrypted on this device before they are stored.',
    icon: DriveIcon,
    screen: DriveScreen,
    miniatures: true,
  },
  {
    id: 'shared',
    label: 'Shared',
    description: 'What other accounts have sent you, decrypted on this device.',
    icon: SharingIcon,
    screen: SharedScreen,
    miniatures: true,
  },
] as const satisfies readonly NavItem[];

type TabId = (typeof NAV_ITEMS)[number]['id'];

const EXIT_ICONS: Record<SessionExitId, ComponentType<IconProps>> = {
  lock: LockSessionIcon,
  'remove-browser': LogOutIcon,
};

export default function AppShell() {
  const { account, lock, removeBrowser, holds, chainProblem, notice, dismissNotice, reportError } = useCryple();
  const navItems: readonly NavItem[] = NAV_ITEMS.filter(
    (item: NavItem) => item.scope === undefined || holds(item.scope),
  );
  const [tab, setTab] = useState<TabId>(navItems[0]?.id as TabId);
  const [confirming, setConfirming] = useState<SessionExit>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitError, setExitError] = useState<string>();
  const [chainProblemDismissed, setChainProblemDismissed] = useState(false);
  const [stripSlot, setStripSlot] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);

  const exits = sessionExits();
  const lockable = lockExit(exits);
  const leave = removeBrowserExit(exits);
  const current: NavItem = navItems.find((item) => item.id === tab) ?? navItems[0];
  const Screen = current.screen;
  const ScreenActions = current.actions;
  const measure = contentMeasure(current.miniatures === true);

  function select(id: string) {
    setTab(id as TabId);
    setMenuOpen(false);
  }

  function run(exit: SessionExit) {
    if (exit.confirm !== undefined && confirming?.id !== exit.id) {
      setConfirming(exit);
      return;
    }
    setConfirming(undefined);
    if (exit.id === 'lock') {
      lock();
    } else {
      void removeBrowser().catch((error: unknown) => setExitError(reportError(error)));
    }
  }

  return (
    <VaultRevealProvider>
      <div className="flex min-h-screen bg-ground">
        <aside className="sticky top-[var(--staging-banner-h)] hidden h-[calc(100vh-var(--staging-banner-h))] w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
          <SidebarContent navItems={navItems} active={tab} storage={holds('files')} onSelect={select} />
        </aside>

        {menuOpen ? (
          <MobileMenu onClose={() => setMenuOpen(false)}>
            <SidebarContent navItems={navItems} active={tab} storage={holds('files')} onSelect={select} />
          </MobileMenu>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-[var(--staging-banner-h)] z-10">
            <header className="relative z-10 border-b border-line bg-surface/90 backdrop-blur md:hidden">
              <div className="flex items-center justify-between gap-2 py-2 pr-4 pl-2">
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="Open menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen(true)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                  >
                    <MenuIcon className="h-6 w-6 shrink-0" />
                  </button>
                  <h1 className="truncate text-headline text-ink">{current.label}</h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {ScreenActions ? <ScreenActions /> : null}
                  {lockable ? <LockButton exit={lockable} onRun={run} /> : null}
                  <AccountMenu
                    username={account?.username}
                    logOut={leave}
                    onSettings={() => setSettingsOpen(true)}
                    onLogOut={run}
                  />
                </div>
              </div>
            </header>

            <header className="relative z-10 hidden border-b border-line bg-surface/90 py-4 backdrop-blur md:block">
              <div className={`mx-auto flex w-full ${measure} items-center justify-between gap-4 px-6`}>
                <div className="min-w-0">
                  <h1 className="text-headline-lg text-ink">{current.label}</h1>
                  <p className="mt-0.5 truncate text-compact text-ink-muted">{current.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {ScreenActions ? <ScreenActions /> : null}
                  {lockable ? <LockButton exit={lockable} onRun={run} /> : null}
                  <AccountMenu
                    username={account?.username}
                    logOut={leave}
                    onSettings={() => setSettingsOpen(true)}
                    onLogOut={run}
                  />
                </div>
              </div>
            </header>
            <div ref={setStripSlot} className="empty:hidden" />
          </div>

          <main className={`mx-auto w-full ${measure} flex-1 space-y-8 p-4 md:p-6`}>
            {chainProblem && !chainProblemDismissed ? (
              <Notice tone="danger" onDismiss={() => setChainProblemDismissed(true)}>
                {chainProblem}
              </Notice>
            ) : null}
            {notice ? (
              <Notice tone="info" onDismiss={dismissNotice}>
                {notice}
              </Notice>
            ) : null}
            {exitError ? (
              <Notice tone="danger" onDismiss={() => setExitError(undefined)}>
                {exitError}
              </Notice>
            ) : null}
            {confirming?.confirm !== undefined ? (
              <Notice tone="warning">
                <p>{confirming.confirm}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="danger" onClick={() => run(confirming)}>
                    {confirming.label}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirming(undefined)}>
                    Stay signed in
                  </Button>
                </div>
              </Notice>
            ) : null}

            <ScreenStripSlotProvider value={stripSlot}>
              <SidePanelSlotProvider value={panelSlot}>
                <Screen />
              </SidePanelSlotProvider>
            </ScreenStripSlotProvider>
          </main>

          {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
        </div>

        <div ref={setPanelSlot} className="contents" />
      </div>
    </VaultRevealProvider>
  );
}

function SidebarContent({
  navItems,
  active,
  storage,
  onSelect,
}: {
  navItems: readonly NavItem[];
  active: string;
  storage: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <BrandMark />
      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavButton key={item.id} item={item} active={active === item.id} onSelect={() => onSelect(item.id)} />
        ))}
      </nav>
      {storage ? <StorageMeter /> : null}
    </>
  );
}

function MobileMenu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-x-0 top-[var(--staging-banner-h)] bottom-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="relative motion-safe:animate-slide-in-left flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface px-3 py-5 shadow-card"
      >
        <button
          ref={closeButton}
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="absolute top-4 right-3 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <CloseIcon className="h-5 w-5 shrink-0" />
        </button>
        {children}
      </aside>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <Image src="/cryple-logo.png" alt="Cryple" width={30} height={30} priority />
      <span className="flex flex-col leading-none">
        <span className="text-headline text-ink">Cryple</span>
        <span className="mt-1 text-caption text-ink-faint uppercase">Zero-knowledge</span>
      </span>
    </div>
  );
}

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: () => void }) {
  const ItemIcon = item.icon;

  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-compact font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 w-full ${active ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-raised hover:text-ink'}`}
    >
      <ItemIcon className={`h-5 w-5 shrink-0 ${active ? 'text-brand-500' : 'text-ink-muted'}`} />
      <span>{item.label}</span>
    </button>
  );
}

function LockButton({ exit, onRun }: { exit: SessionExit; onRun: (exit: SessionExit) => void }) {
  const ExitIcon = EXIT_ICONS[exit.id];

  return (
    <Button variant="secondary" title={exit.description} onClick={() => onRun(exit)}>
      <ExitIcon className="h-4 w-4 shrink-0" />
      {exit.label}
    </Button>
  );
}
