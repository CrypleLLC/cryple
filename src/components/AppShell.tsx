'use client';

import { useState, type ComponentType } from 'react';
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
import { useCryple } from './CrypleProvider';
import NotesScreen from './NotesScreen';
import PasswordsScreen from './PasswordsScreen';
import AccountMenu from './AccountMenu';
import SharedScreen from './SharedScreen';
import SettingsModal from './SettingsModal';
import VaultScreen from './VaultScreen';
import { VaultRevealAction, VaultRevealProvider } from './VaultReveal';
import {
  DocumentsIcon,
  DriveIcon,
  LockSessionIcon,
  LogOutIcon,
  NotesIcon,
  PasswordsIcon,
  VaultIcon,
  type IconProps,
  SharingIcon,
} from './icons';
import StorageMeter from './StorageMeter';
import { Button, Notice, Spinner } from './ui';

const DocumentsScreen = dynamic(() => import('./DocumentsScreen'), {
  loading: () => <Spinner />,
});

const DriveScreen = dynamic(() => import('./DriveScreen'), {
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
  const { account, lock, removeBrowser, holds, chainProblem, notice, reportError } = useCryple();
  const navItems: readonly NavItem[] = NAV_ITEMS.filter(
    (item: NavItem) => item.scope === undefined || holds(item.scope),
  );
  const [tab, setTab] = useState<TabId>(navItems[0]?.id as TabId);
  const [confirming, setConfirming] = useState<SessionExit>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitError, setExitError] = useState<string>();

  const exits = sessionExits();
  const lockable = lockExit(exits);
  const leave = removeBrowserExit(exits);
  const current: NavItem = navItems.find((item) => item.id === tab) ?? navItems[0];
  const Screen = current.screen;
  const ScreenActions = current.actions;
  const measure = contentMeasure(current.miniatures === true);

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
          <BrandMark />
          <nav className="mt-8 flex flex-1 flex-col gap-1">
            {navItems.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={tab === item.id}
                onSelect={() => setTab(item.id as TabId)}
              />
            ))}
          </nav>
          {holds('files') ? <StorageMeter /> : null}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-[var(--staging-banner-h)] z-10 border-b border-line bg-surface/90 backdrop-blur md:hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <BrandMark />
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
            <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
              {navItems.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={tab === item.id}
                  compact
                  onSelect={() => setTab(item.id as TabId)}
                />
              ))}
            </nav>
          </header>

          <header className="sticky top-[var(--staging-banner-h)] z-10 hidden border-b border-line bg-surface/90 py-4 backdrop-blur md:block">
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

          <main className={`mx-auto w-full ${measure} flex-1 space-y-8 p-4 md:p-6`}>
            {chainProblem ? <Notice tone="danger">{chainProblem}</Notice> : null}
            {notice ? <Notice tone="info">{notice}</Notice> : null}
            {exitError ? <Notice tone="danger">{exitError}</Notice> : null}
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

            <Screen />
          </main>

          {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
        </div>
      </div>
    </VaultRevealProvider>
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

function NavButton({
  item,
  active,
  compact = false,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  const ItemIcon = item.icon;

  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-compact font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        compact ? 'shrink-0' : 'w-full'
      } ${
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-ink-soft hover:bg-raised hover:text-ink'
      }`}
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
