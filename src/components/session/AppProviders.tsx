'use client';

import type { ReactNode } from 'react';
import { ZekkeProvider } from './ZekkeProvider';

export default function AppProviders({ children }: { children: ReactNode }) {
  return <ZekkeProvider>{children}</ZekkeProvider>;
}
