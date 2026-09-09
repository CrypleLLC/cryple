'use client';

import { useEffect, useState, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { hasSeedVault } from '@/lib/pin';
import {
  accountInitial,
  sessionExits,
  type SessionExit,
  type SessionExitId,
} from '@/lib/app';
import { useCryple } from './CrypleProvider';
import NotesScreen from './NotesScreen';
import SecurityScreen from './SecurityScreen';
import VaultScreen from './VaultScreen';
import { VaultRevealAction, VaultRevealProvider } from './VaultReveal';
import {
  DocumentsIcon,
  LockSessionIcon,
  LogOutIcon,
  NotesIcon,
  SecurityIcon,
  VaultIcon,
  type IconProps,
} from './icons';
import { Badge, Button, Notice, Spinner } from './ui';

const DocumentsScreen = dynamic(() => import('./DocumentsScreen'), {
  loading: () => <Spinner />,
});

interface NavItem {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<IconProps>;
  screen: ComponentType;
  actions?: ComponentType;
}

const NAV_ITEMS = [
  {
    id: 'vault',
    label: 'Vault',
    description: 'Everything stored under your account.',
    icon: VaultIcon,
    screen: VaultScreen,
    actions: VaultRevealAction,
  },
  {
    id: 'notes',
    label: 'Notes',
    description: 'Letters and instructions you write, encrypted before they leave this device.',
    icon: NotesIcon,
    screen: NotesScreen,
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Long-form writing, encrypted here and synced across your devices.',
    icon: DocumentsIcon,
    screen: DocumentsScreen,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'How signing in to this account works.',
    icon: SecurityIcon,
    screen: SecurityScreen,
  },
] as const satisfies readonly NavItem[];

type TabId = (typeof NAV_ITEMS)[number]['id'];

const EXIT_ICONS: Record<SessionExitId, ComponentType<IconProps>> = {
  lock: LockSessionIcon,
  'log-out': LogOutIcon,
};

export default function AppShell() {
  const { account, paranoid, lock, logOut } = useCryple();
  const [tab, setTab] = useState<TabId>('vault');
  const [remembersPhrase, setRemembersPhrase] = useState(false);
  const [confirming, setConfirming] = useState<SessionExit>();

  useEffect(() => setRemembersPhrase(hasSeedVault()), [paranoid]);

  const exits = sessionExits(remembersPhrase);
  const current: NavItem = NAV_ITEMS.find((item) => item.id === tab) ?? NAV_ITEMS[0];
  const Screen = current.screen;
  const ScreenActions = current.actions;

  function run(exit: SessionExit) {
    if (exit.confirm !== undefined && confirming?.id !== exit.id) {
      setConfirming(exit);
      return;
    }
    setConfirming(undefined);
    if (exit.id === 'lock') {
      lock();
    } else {
      logOut();
    }
  }

  return (
    <VaultRevealProvider>
      <div className="flex min-h-screen bg-ground">
        <aside className="sticky top-[var(--staging-banner-h)] hidden h-[calc(100vh-var(--staging-banner-h))] w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
          <BrandMark />
          <nav className="mt-8 flex flex-1 flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={tab === item.id}
                onSelect={() => setTab(item.id)}
              />
            ))}
          </nav>
          <AccountSummary username={account?.username} paranoid={paranoid} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-[var(--staging-banner-h)] z-10 border-b border-line bg-surface/90 backdrop-blur md:hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <BrandMark />
              <div className="flex shrink-0 items-center gap-2">
                {ScreenActions ? <ScreenActions /> : null}
                <ExitButtons exits={exits} onRun={run} />
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
              {NAV_ITEMS.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={tab === item.id}
                  compact
                  onSelect={() => setTab(item.id)}
                />
              ))}
            </nav>
          </header>

          <header className="sticky top-[var(--staging-banner-h)] z-10 hidden items-center justify-between gap-4 border-b border-line bg-surface/90 px-6 py-4 backdrop-blur md:flex">
            <div className="min-w-0">
              <h1 className="text-headline-lg text-ink">{current.label}</h1>
              <p className="mt-0.5 truncate text-compact text-ink-muted">{current.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {ScreenActions ? <ScreenActions /> : null}
              <ExitButtons exits={exits} onRun={run} />
            </div>
          </header>

          <main className="w-full flex-1 space-y-5 p-4 md:p-6">
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
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-compact font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
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

function AccountSummary({
  username,
  paranoid,
}: {
  username: string | undefined;
  paranoid: boolean;
}) {
  return (
    <div className="mt-4 rounded-xl border border-line bg-raised p-3">
      <div className="flex items-center gap-3">
        <span className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white">
          {accountInitial(username)}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="truncate text-compact font-semibold text-ink">{username}</p>
          <Badge tone={paranoid ? 'brand' : 'neutral'}>
            {paranoid ? 'Paranoid mode' : 'Standard mode'}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function ExitButtons({
  exits,
  onRun,
}: {
  exits: SessionExit[];
  onRun: (exit: SessionExit) => void;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      {exits.map((exit) => {
        const ExitIcon = EXIT_ICONS[exit.id];

        return (
          <Button
            key={exit.id}
            variant={exit.destructive ? 'danger' : 'secondary'}
            title={exit.description}
            onClick={() => onRun(exit)}
          >
            <ExitIcon className="h-4 w-4 shrink-0" />
            {exit.label}
          </Button>
        );
      })}
    </div>
  );
}
