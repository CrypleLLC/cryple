import { describe, expect, it } from 'vitest';
import {
  backspaceInPin,
  pinBoxLabel,
  pinCompleted,
  pinDigits,
  reachablePinBox,
  stepPinFocus,
  typeIntoPin,
} from './pin-entry';

describe('pinDigits', () => {
  it('spreads the value over one box per digit and leaves the rest empty', () => {
    expect(pinDigits('12', 6)).toEqual(['1', '2', '', '', '', '']);
  });
});

describe('pinBoxLabel', () => {
  it('names the box by its position so a screen reader can tell them apart', () => {
    expect(pinBoxLabel('PIN', 0, 6)).toBe('PIN, digit 1 of 6');
  });
});

describe('reachablePinBox', () => {
  it('sends a click past the typed digits to the first empty box', () => {
    expect(reachablePinBox('12', 5, 6)).toBe(2);
  });

  it('keeps a click on a filled box where it is', () => {
    expect(reachablePinBox('1234', 1, 6)).toBe(1);
  });

  it('never goes past the last box', () => {
    expect(reachablePinBox('123456', 6, 6)).toBe(5);
  });
});

describe('typeIntoPin', () => {
  it('appends a digit and moves to the next box', () => {
    expect(typeIntoPin('12', 2, '3', 6)).toEqual({ value: '123', focus: 3 });
  });

  it('replaces a filled digit in place', () => {
    expect(typeIntoPin('123', 1, '9', 6)).toEqual({ value: '193', focus: 2 });
  });

  it('keeps the new digit when the browser appended it to the old one', () => {
    expect(typeIntoPin('123', 1, '29', 6)).toEqual({ value: '193', focus: 2 });
    expect(typeIntoPin('123', 1, '92', 6)).toEqual({ value: '193', focus: 2 });
    expect(typeIntoPin('123', 1, '22', 6)).toEqual({ value: '123', focus: 2 });
  });

  it('fills the following boxes from a pasted PIN', () => {
    expect(typeIntoPin('', 0, '123456', 6)).toEqual({ value: '123456', focus: 5 });
  });

  it('drops what does not fit and anything that is not a digit', () => {
    expect(typeIntoPin('12', 2, '3-4 5a678', 6)).toEqual({ value: '123456', focus: 5 });
  });

  it('writes into the first empty box whichever box was typed in', () => {
    expect(typeIntoPin('1', 4, '2', 6)).toEqual({ value: '12', focus: 2 });
  });

  it('ignores a key that is not a digit', () => {
    expect(typeIntoPin('12', 2, 'a', 6)).toEqual({ value: '12', focus: 2 });
    expect(typeIntoPin('12', 1, '2a', 6)).toEqual({ value: '12', focus: 1 });
  });

  it('removes the digit of a box that was cleared', () => {
    expect(typeIntoPin('123', 1, '', 6)).toEqual({ value: '13', focus: 1 });
  });
});

describe('pinCompleted', () => {
  it('fires when the sixth digit arrives', () => {
    expect(pinCompleted('12345', '123456', 6)).toBe(true);
  });

  it('fires again when a digit of a full PIN is corrected', () => {
    expect(pinCompleted('123456', '123956', 6)).toBe(true);
  });

  it('stays quiet while digits are missing, or when nothing changed', () => {
    expect(pinCompleted('1234', '12345', 6)).toBe(false);
    expect(pinCompleted('123456', '12345', 6)).toBe(false);
    expect(pinCompleted('123456', '123456', 6)).toBe(false);
  });
});

describe('backspaceInPin', () => {
  it('leaves a filled box to the input, which clears it', () => {
    expect(backspaceInPin('123', 1, 6)).toBeUndefined();
  });

  it('removes the previous digit from an empty box and moves back to it', () => {
    expect(backspaceInPin('123', 3, 6)).toEqual({ value: '12', focus: 2 });
  });

  it('does nothing in the first box', () => {
    expect(backspaceInPin('', 0, 6)).toBeUndefined();
  });
});

describe('stepPinFocus', () => {
  it('moves between filled boxes and stops at the first empty one', () => {
    expect(stepPinFocus('123', 1, -1, 6)).toBe(0);
    expect(stepPinFocus('123', 3, 1, 6)).toBe(3);
    expect(stepPinFocus('123', 0, -1, 6)).toBe(0);
  });
});
