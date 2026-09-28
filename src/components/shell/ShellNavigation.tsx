'use client';

import { createContext, useContext, type ComponentType } from 'react';

export interface ShellDestination {
  id: string;
  label: string;
  description: string;
  appIcon: ComponentType;
}

export interface ShellNavigation {
  destinations: readonly ShellDestination[];
  open: (id: string) => void;
}

const ShellNavigationContext = createContext<ShellNavigation>({
  destinations: [],
  open: () => undefined,
});

export const ShellNavigationProvider = ShellNavigationContext.Provider;

export function useShellNavigation(): ShellNavigation {
  return useContext(ShellNavigationContext);
}
