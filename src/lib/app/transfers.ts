import { ApiError, describeWait } from '@/lib/api';
import type { UploadProgress } from '@/lib/files';

export const DEFAULT_CREATION_PAUSE_SECONDS = 60;

export interface Transfer {
  key: string;
  fileId: string;
  name: string;
  mime: string;
  bytes: number;
  percent: number;
  phase: UploadProgress['phase'] | 'failed' | 'paused';
  error?: string;
  note?: string;
}

export interface NewTransfer {
  key: string;
  fileId: string;
  name: string;
  mime: string;
  bytes: number;
}

let running: readonly Transfer[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly Transfer[]): void {
  running = next;
  for (const listener of listeners) {
    listener();
  }
}

export function transfersInFlight(): readonly Transfer[] {
  return running;
}

export function subscribeToTransfers(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function beginTransfer(transfer: NewTransfer): void {
  publish([...running, { ...transfer, percent: 0, phase: 'uploading' }]);
}

export function advanceTransfer(
  key: string,
  phase: UploadProgress['phase'],
  percent: number,
): void {
  if (!running.some((transfer) => transfer.key === key)) {
    return;
  }

  publish(
    running.map((transfer) => (transfer.key === key ? { ...transfer, phase, percent } : transfer)),
  );
}

export function failTransfer(key: string, error: string): void {
  if (!running.some((transfer) => transfer.key === key)) {
    return;
  }

  publish(
    running.map((transfer) =>
      transfer.key === key ? { ...transfer, phase: 'failed', error } : transfer,
    ),
  );
}

export function pauseTransfer(key: string, note: string): void {
  if (!running.some((transfer) => transfer.key === key)) {
    return;
  }

  publish(
    running.map((transfer) =>
      transfer.key === key ? { ...transfer, phase: 'paused', note } : transfer,
    ),
  );
}

export function creationPauseSeconds(error: unknown): number | undefined {
  if (!(error instanceof ApiError) || !error.isRateLimited || error.endpoint !== 'POST /files') {
    return undefined;
  }
  return error.retryAfterSeconds ?? DEFAULT_CREATION_PAUSE_SECONDS;
}

export function pausedUploadNote(seconds: number): string {
  return (
    'Paused: this account started many uploads in the last few minutes. Nothing failed, and ' +
    `this one carries on by itself ${describeWait(seconds)}.`
  );
}

export function dropTransfer(key: string): void {
  const next = running.filter((transfer) => transfer.key !== key);
  if (next.length !== running.length) {
    publish(next);
  }
}

export function resetTransfers(): void {
  publish([]);
}
