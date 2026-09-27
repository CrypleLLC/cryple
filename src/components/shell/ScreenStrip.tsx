'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const ScreenStripSlotContext = createContext<HTMLElement | null>(null);

export const ScreenStripSlotProvider = ScreenStripSlotContext.Provider;

export function ScreenStrip({ children }: { children: ReactNode }) {
  const slot = useContext(ScreenStripSlotContext);
  return slot === null ? <>{children}</> : createPortal(children, slot);
}
