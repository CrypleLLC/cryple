'use client';

import { useState } from 'react';
import { useCryple } from './CrypleProvider';
import GuardiansScreen from './GuardiansScreen';
import SuccessionScreen from './SuccessionScreen';
import VaultScreen from './VaultScreen';
import { Button } from './ui';

const TABS = [
  { id: 'vault', label: 'Vault' },
  { id: 'guardians', label: 'Guardians' },
  { id: 'succession', label: 'Succession' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AppShell() {
  const { account, paranoid, lock } = useCryple();
  const [tab, setTab] = useState<TabId>('vault');

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
        <Button variant="secondary" onClick={lock}>
          Lock
        </Button>
      </header>

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
    </div>
  );
}
