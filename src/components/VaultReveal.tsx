'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';
import { Button } from './ui';

interface VaultRevealValue {
  revealed: boolean;
  toggle(): void;
}

const VaultRevealContext = createContext<VaultRevealValue | undefined>(undefined);

export function VaultRevealProvider({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const toggle = useCallback(() => setRevealed((current) => !current), []);
  const value = useMemo<VaultRevealValue>(() => ({ revealed, toggle }), [revealed, toggle]);

  return <VaultRevealContext.Provider value={value}>{children}</VaultRevealContext.Provider>;
}

export function useVaultReveal(): VaultRevealValue {
  const value = useContext(VaultRevealContext);
  if (value === undefined) {
    throw new Error('useVaultReveal must be used inside <VaultRevealProvider>');
  }
  return value;
}

export function VaultRevealAction() {
  const { revealed, toggle } = useVaultReveal();

  return (
    <Button
      variant="secondary"
      onClick={toggle}
      title={revealed ? 'Hide every value in the list' : 'Show every value in the list'}
    >
      {revealed ? <EyeOffIcon className="h-4 w-4 shrink-0" /> : <EyeIcon className="h-4 w-4 shrink-0" />}
      {revealed ? 'Hide values' : 'Show values'}
    </Button>
  );
}
