'use client';

import type { ReactNode } from 'react';
import { CrypleProvider } from './CrypleProvider';

export default function AppProviders({ children }: { children: ReactNode }) {
  return <CrypleProvider>{children}</CrypleProvider>;
}
