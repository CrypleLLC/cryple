'use client';

import { useEffect, useState } from 'react';
import { hasSeedVault } from '@/lib/pin';
import { sessionExits, type SessionExit } from '@/lib/app';
import { useCryple } from './CrypleProvider';
import GuardiansScreen from './GuardiansScreen';
import SecurityScreen from './SecurityScreen';
import SuccessionScreen from './SuccessionScreen';
import VaultScreen from './VaultScreen';
import { Button, Notice } from './ui';

const TABS = [
  { id: 'vault', label: 'Vault' },
  { id: 'guardians', label: 'Guardians' },
  { id: 'succession', label: 'Succession' },
  { id: 'security', label: 'Security' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AppShell() {
  const { account, paranoid, lock, logOut } = useCryple();
  const [tab, setTab] = useState<TabId>('vault');
  const [remembersPhrase, setRemembersPhrase] = useState(false);
  const [confirming, setConfirming] = useState<SessionExit>();

  useEffect(() => setRemembersPhrase(hasSeedVault()), [paranoid]);

  const exits = sessionExits(remembersPhrase);

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
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {account?.username}
          </p>
          <p className="text-xs text-slate-500">
            {paranoid ? 'Paranoid mode' : 'Standard mode'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {exits.map((exit) => (
            <Button
              key={exit.id}
              variant={exit.destructive ? 'danger' : 'secondary'}
              title={exit.description}
              onClick={() => run(exit)}
            >
              {exit.label}
            </Button>
          ))}
        </div>
      </header>

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

      <nav className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              tab === entry.id
                ? 'border-slate-900 font-medium text-slate-900 dark:border-slate-100 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'vault' ? <VaultScreen /> : null}
      {tab === 'guardians' ? <GuardiansScreen /> : null}
      {tab === 'succession' ? <SuccessionScreen /> : null}
      {tab === 'security' ? <SecurityScreen /> : null}
    </div>
  );
}
