'use client';

import AppShell from '@/components/shell/AppShell';
import SessionGate from '@/components/session/SessionGate';

export default function Home() {
  return (
    <SessionGate>
      <main className="min-h-screen bg-ground">
        <AppShell />
      </main>
    </SessionGate>
  );
}
