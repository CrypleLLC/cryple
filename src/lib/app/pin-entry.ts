export interface PinEntry {
  value: string;
  focus: number;
}

export function pinDigits(value: string, length: number): string[] {
  return Array.from({ length }, (_, index) => value[index] ?? '');
}

export function pinBoxLabel(label: string, index: number, length: number): string {
  return `${label}, digit ${index + 1} of ${length}`;
}

export function reachablePinBox(value: string, index: number, length: number): number {
  return Math.max(0, Math.min(index, value.length, length - 1));
}

export function typeIntoPin(value: string, index: number, typed: string, length: number): PinEntry {
  const box = reachablePinBox(value, index, length);
  const held = value[box] ?? '';
  const digits = typedDigits(typed, held);

  if (digits.length === 0) {
    if (typed.length > 0 || held === '') {
      return { value, focus: box };
    }
    return { value: value.slice(0, box) + value.slice(box + 1), focus: box };
  }

  const written = (value.slice(0, box) + digits + value.slice(box + digits.length)).slice(
    0,
    length,
  );
  return { value: written, focus: Math.min(box + digits.length, length - 1) };
}

export function pinCompleted(previous: string, next: string, length: number): boolean {
  return next.length === length && next !== previous;
}

export function backspaceInPin(value: string, index: number, length: number): PinEntry | undefined {
  const box = reachablePinBox(value, index, length);
  if (value[box] !== undefined || box === 0) {
    return undefined;
  }
  return { value: value.slice(0, box - 1) + value.slice(box), focus: box - 1 };
}

export function stepPinFocus(
  value: string,
  index: number,
  direction: -1 | 1,
  length: number,
): number {
  return reachablePinBox(value, index + direction, length);
}

function typedDigits(typed: string, held: string): string {
  return withoutHeldDigit(typed, held).replace(/\D/g, '');
}

function withoutHeldDigit(typed: string, held: string): string {
  if (held === '' || typed.length !== 2) {
    return typed;
  }
  if (typed.startsWith(held)) {
    return typed.slice(1);
  }
  if (typed.endsWith(held)) {
    return typed.slice(0, 1);
  }
  return typed;
}
