export const CLIPBOARD_CLEAR_AFTER_MS = 30_000;

export const CLIPBOARD_COPIED_LABEL = `Copied — clears in ${CLIPBOARD_CLEAR_AFTER_MS / 1000} s`;

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export interface FocusTarget {
  addEventListener(type: 'focus', listener: () => void): void;
  removeEventListener(type: 'focus', listener: () => void): void;
}

export type ClearScheduler = (callback: () => void, delayMs: number) => () => void;

export interface SensitiveClipboardOptions {
  clipboard: ClipboardWriter;
  focus: FocusTarget;
  clearAfterMs?: number;
  schedule?: ClearScheduler;
}

export interface SensitiveClipboard {
  copy(value: string): Promise<void>;
}

const scheduleWithTimeout: ClearScheduler = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

export function createSensitiveClipboard(options: SensitiveClipboardOptions): SensitiveClipboard {
  const clearAfterMs = options.clearAfterMs ?? CLIPBOARD_CLEAR_AFTER_MS;
  const schedule = options.schedule ?? scheduleWithTimeout;

  let generation = 0;
  let cancelTimer: (() => void) | undefined;
  let retryOnFocus: (() => void) | undefined;

  function forgetPendingClear(): void {
    cancelTimer?.();
    cancelTimer = undefined;
    if (retryOnFocus !== undefined) {
      options.focus.removeEventListener('focus', retryOnFocus);
      retryOnFocus = undefined;
    }
  }

  function waitForFocus(owner: number): void {
    const retry = () => {
      options.focus.removeEventListener('focus', retry);
      retryOnFocus = undefined;
      clear(owner);
    };
    retryOnFocus = retry;
    options.focus.addEventListener('focus', retry);
  }

  function clear(owner: number): void {
    cancelTimer = undefined;
    options.clipboard.writeText('').catch(() => {
      if (owner === generation) {
        waitForFocus(owner);
      }
    });
  }

  return {
    async copy(value: string): Promise<void> {
      forgetPendingClear();
      generation += 1;
      const owner = generation;

      await options.clipboard.writeText(value);
      cancelTimer = schedule(() => clear(owner), clearAfterMs);
    },
  };
}
