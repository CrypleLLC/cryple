import { describe, expect, it } from 'vitest';
import { isBackdropDismissal, scrollLockTransition, trapAction } from './modal';

const tab = { key: 'Tab', shiftKey: false };
const shiftTab = { key: 'Tab', shiftKey: true };

describe('the keyboard contract of a modal', () => {
  it('closes on Escape wherever focus is', () => {
    for (const active of [-1, 0, 2]) {
      expect(trapAction({ key: 'Escape', shiftKey: false }, { count: 3, active })).toEqual({
        kind: 'close',
      });
    }
  });

  it('lets ordinary keys through untouched', () => {
    for (const key of ['a', 'Enter', ' ', 'ArrowDown']) {
      expect(trapAction({ key, shiftKey: false }, { count: 3, active: 1 })).toEqual({ kind: 'pass' });
    }
  });

  it('leaves tab order to the browser in the middle of the dialog', () => {
    expect(trapAction(tab, { count: 3, active: 0 })).toEqual({ kind: 'pass' });
    expect(trapAction(tab, { count: 3, active: 1 })).toEqual({ kind: 'pass' });
    expect(trapAction(shiftTab, { count: 3, active: 2 })).toEqual({ kind: 'pass' });
  });

  it('wraps at both ends rather than letting focus escape', () => {
    expect(trapAction(tab, { count: 3, active: 2 })).toEqual({ kind: 'focus', index: 0 });
    expect(trapAction(shiftTab, { count: 3, active: 0 })).toEqual({ kind: 'focus', index: 2 });
  });

  it('pulls focus back in when it is already outside', () => {
    expect(trapAction(tab, { count: 3, active: -1 })).toEqual({ kind: 'focus', index: 0 });
    expect(trapAction(shiftTab, { count: 3, active: -1 })).toEqual({ kind: 'focus', index: 2 });
  });

  it('swallows Tab in a dialog with nothing tabbable', () => {
    expect(trapAction(tab, { count: 0, active: -1 })).toEqual({ kind: 'hold' });
    expect(trapAction(shiftTab, { count: 0, active: -1 })).toEqual({ kind: 'hold' });
  });

  it('handles a single tabbable element, where both ends are the same one', () => {
    expect(trapAction(tab, { count: 1, active: 0 })).toEqual({ kind: 'focus', index: 0 });
    expect(trapAction(shiftTab, { count: 1, active: 0 })).toEqual({ kind: 'focus', index: 0 });
  });
});

describe('dismissing by clicking the backdrop', () => {
  it('closes when the press and the release were both on the backdrop', () => {
    expect(isBackdropDismissal(true, true)).toBe(true);
  });

  it('does not close when the press started inside the dialog', () => {
    expect(isBackdropDismissal(false, true)).toBe(false);
  });

  it('does not close when the release landed inside the dialog', () => {
    expect(isBackdropDismissal(true, false)).toBe(false);
  });
});

describe('scroll locking is reference counted', () => {
  it('locks on the first open and unlocks on the last close', () => {
    expect(scrollLockTransition(0, 1)).toBe('lock');
    expect(scrollLockTransition(1, -1)).toBe('unlock');
  });

  it('does nothing while another dialog is still open', () => {
    expect(scrollLockTransition(1, 1)).toBe('none');
    expect(scrollLockTransition(2, -1)).toBe('none');
  });

  it('never unlocks below zero', () => {
    expect(scrollLockTransition(0, -1)).toBe('none');
  });
});
