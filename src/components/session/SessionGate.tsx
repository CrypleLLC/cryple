'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { useCryple } from './CrypleProvider';
import Onboarding from './Onboarding';
import Unlock from './Unlock';
import { Spinner } from '@/components/ui';

export function WelcomeLayout({ width, children }: { width: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 via-ground to-ground px-4 py-12">
      <div className={`mx-auto ${width} space-y-8`}>
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <Image src="/cryple-logo.png" alt="Cryple" width={40} height={40} priority />
            <span className="text-display text-ink">Cryple</span>
          </div>
          <span className="text-caption text-ink-faint uppercase">
            Zero-knowledge by construction
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}

export default function SessionGate({ children }: { children: ReactNode }) {
  const { phase } = useCryple();

  if (phase === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ground">
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

  return <>{children}</>;
}
