'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import AppShell from '@/components/AppShell';
import { CrypleProvider, useCryple } from '@/components/CrypleProvider';
import Onboarding from '@/components/Onboarding';
import Unlock from '@/components/Unlock';
import { Spinner } from '@/components/ui';

export default function Home() {
  return (
    <CrypleProvider>
      <Phase />
    </CrypleProvider>
  );
}

function Phase() {
  const { phase } = useCryple();

  if (phase === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Spinner />
      </main>
    );
  }
  if (phase === 'onboarding') {
    return (
      <WelcomeLayout width="max-w-2xl">
        <Onboarding />
      </WelcomeLayout>
    );
  }
  if (phase === 'locked') {
    return (
      <WelcomeLayout width="max-w-md">
        <Unlock />
      </WelcomeLayout>
    );
  }

  return (
    <main className="min-h-screen bg-white dark:bg-slate-950">
      <AppShell />
    </main>
  );
}

function WelcomeLayout({ width, children }: { width: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 via-slate-50 to-slate-50 px-4 py-12 dark:from-brand-950 dark:via-slate-950 dark:to-slate-950">
      <div className={`mx-auto ${width} space-y-8`}>
        <div className="flex items-center justify-center gap-3">
          <Image src="/cryple-logo.png" alt="Cryple" width={40} height={40} priority />
          <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Cryple
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}
