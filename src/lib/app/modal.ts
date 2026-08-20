export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export type TrapAction =
  | { kind: 'close' }
  | { kind: 'focus'; index: number }
  | { kind: 'hold' }
  | { kind: 'pass' };

export interface TrapState {
  /** How many tabbable elements the dialog currently holds. */
  count: number;
  /** Index of the focused one, or -1 when focus has left the dialog. */
  active: number;
}

/**
 * The whole keyboard contract of a modal, as a decision rather than as DOM
 * calls: Escape closes, Tab cycles, and focus never leaves.
 *
 * `pass` means let the browser move focus — the common case, and the reason a
 * trap does not have to re-implement tab order. Everything else is a case where
 * the browser would move focus *out* of the dialog, which is the one thing a
 * modal cannot allow.
 */
export function trapAction(event: { key: string; shiftKey: boolean }, state: TrapState): TrapAction {
  if (event.key === 'Escape') {
    return { kind: 'close' };
  }

  if (event.key !== 'Tab') {
    return { kind: 'pass' };
  }

  // A dialog with nothing tabbable still has to swallow Tab. Letting it through
  // walks focus into the page behind, which a screen reader then reads as if the
  // modal were not there.
  if (state.count === 0) {
    return { kind: 'hold' };
  }

  if (event.shiftKey) {
    return state.active <= 0 ? { kind: 'focus', index: state.count - 1 } : { kind: 'pass' };
  }

  return state.active === -1 || state.active === state.count - 1
    ? { kind: 'focus', index: 0 }
    : { kind: 'pass' };
}

/**
 * A click closes only when it both started and ended on the backdrop.
 *
 * Testing the release alone is the usual shortcut and it has a visible bug:
 * select text inside the dialog, drag past its edge, let go — the click lands on
 * the backdrop and the dialog vanishes mid-selection.
 */
export function isBackdropDismissal(pressedOnBackdrop: boolean, releasedOnBackdrop: boolean): boolean {
  return pressedOnBackdrop && releasedOnBackdrop;
}

/**
 * Scroll locking is reference-counted so a nested dialog closing does not hand
 * the page back its scrollbar while an outer one is still open.
 */
export function scrollLockTransition(open: number, delta: 1 | -1): 'lock' | 'unlock' | 'none' {
  const next = Math.max(0, open + delta);

  if (open === 0 && next === 1) {
    return 'lock';
  }

  return next === 0 && open === 1 ? 'unlock' : 'none';
}
