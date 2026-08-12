'use client';

import AppShell from '@/components/AppShell';
import SessionGate from '@/components/SessionGate';

export default function Home() {
  return (
    <SessionGate>
      <main className="min-h-screen bg-white dark:bg-slate-950">
        <AppShell />
      </main>
    </SessionGate>
  );
}
