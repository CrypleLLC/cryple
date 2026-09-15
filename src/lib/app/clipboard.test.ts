import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_CLEAR_AFTER_MS,
  createSensitiveClipboard,
  type ClearScheduler,
  type FocusTarget,
} from './clipboard';

function fakeClipboard() {
  const writes: string[] = [];
  let refuse = false;

  return {
    writes,
    refuseWrites(value: boolean) {
      refuse = value;
    },
    async writeText(text: string) {
      if (refuse) {
        throw new Error('Document is not focused.');
      }
      writes.push(text);
    },
  };
}

function fakeFocus() {
  const listeners = new Set<() => void>();
  const target: FocusTarget = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };

  return {
    target,
    listeners,
    fire() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function manualScheduler() {
  const pending: { callback: () => void; delayMs: number; cancelled: boolean }[] = [];
  const schedule: ClearScheduler = (callback, delayMs) => {
    const entry = { callback, delayMs, cancelled: false };
    pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };

  return {
    schedule,
    pending,
    runLive() {
      for (const entry of pending.filter((candidate) => !candidate.cancelled)) {
        entry.cancelled = true;
        entry.callback();
      }
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createSensitiveClipboard', () => {
  it('writes the value and clears it after the window', async () => {
    const clipboard = fakeClipboard();
    const timers = manualScheduler();
    const secrets = createSensitiveClipboard({
      clipboard,
      focus: fakeFocus().target,
      schedule: timers.schedule,
    });

    await secrets.copy('hunter2');

    expect(clipboard.writes).toEqual(['hunter2']);
    expect(timers.pending[0].delayMs).toBe(CLIPBOARD_CLEAR_AFTER_MS);

    timers.runLive();
    await settle();

    expect(clipboard.writes).toEqual(['hunter2', '']);
  });

  it('restarts the window on a second copy rather than clearing the new value early', async () => {
    const clipboard = fakeClipboard();
    const timers = manualScheduler();
    const secrets = createSensitiveClipboard({
      clipboard,
      focus: fakeFocus().target,
      schedule: timers.schedule,
    });

    await secrets.copy('first');
    await secrets.copy('second');

    expect(timers.pending.map((entry) => entry.cancelled)).toEqual([true, false]);

    timers.runLive();
    await settle();

    expect(clipboard.writes).toEqual(['first', 'second', '']);
  });

  it('clears on the next focus when the tab was in the background at the deadline', async () => {
    const clipboard = fakeClipboard();
    const focus = fakeFocus();
    const timers = manualScheduler();
    const secrets = createSensitiveClipboard({
      clipboard,
      focus: focus.target,
      schedule: timers.schedule,
    });

    await secrets.copy('hunter2');
    clipboard.refuseWrites(true);
    timers.runLive();
    await settle();

    expect(focus.listeners.size).toBe(1);

    clipboard.refuseWrites(false);
    focus.fire();
    await settle();

    expect(clipboard.writes).toEqual(['hunter2', '']);
    expect(focus.listeners.size).toBe(0);
  });

  it('stops waiting for focus once a newer copy owns the clipboard', async () => {
    const clipboard = fakeClipboard();
    const focus = fakeFocus();
    const timers = manualScheduler();
    const secrets = createSensitiveClipboard({
      clipboard,
      focus: focus.target,
      schedule: timers.schedule,
    });

    await secrets.copy('first');
    clipboard.refuseWrites(true);
    timers.runLive();
    await settle();
    clipboard.refuseWrites(false);

    await secrets.copy('second');
    focus.fire();
    await settle();

    expect(focus.listeners.size).toBe(0);
    expect(clipboard.writes).toEqual(['first', 'second']);
  });

  it('schedules nothing when the copy itself fails', async () => {
    const clipboard = fakeClipboard();
    const timers = manualScheduler();
    const secrets = createSensitiveClipboard({
      clipboard,
      focus: fakeFocus().target,
      schedule: timers.schedule,
    });

    clipboard.refuseWrites(true);

    await expect(secrets.copy('hunter2')).rejects.toThrow();
    expect(timers.pending).toHaveLength(0);
  });
});
