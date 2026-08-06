'use client';

import AppShell from '@/components/AppShell';
import { CrypleProvider, useCryple } from '@/components/CrypleProvider';
import Onboarding from '@/components/Onboarding';
import Unlock from '@/components/Unlock';
import { Spinner } from '@/components/ui';

export default function Home() {
  return (
    <CrypleProvider>
      <main className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <Phase />
      </main>
    </CrypleProvider>
  );
}

function Phase() {
  const { phase } = useCryple();

  if (phase === 'loading') {
    return <Spinner />;
  }
  if (phase === 'onboarding') {
    return <Onboarding />;
  }
  if (phase === 'locked') {
    return (
      <div className="mx-auto max-w-md">
        <Unlock />
      </div>
    );
  }

  return <AppShell />;
}
