import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceTransfer,
  beginTransfer,
  dropTransfer,
  failTransfer,
  resetTransfers,
  subscribeToTransfers,
  transfersInFlight,
} from './transfers';

const source = { key: 'k1', fileId: 'f1', name: 'holiday.mov', mime: 'video/mp4', bytes: 1000 };

afterEach(() => resetTransfers());

describe('an upload in flight', () => {
  it('starts at nothing sent', () => {
    beginTransfer(source);

    expect(transfersInFlight()).toEqual([{ ...source, percent: 0, phase: 'uploading' }]);
  });

  it('advances only the transfer it names', () => {
    beginTransfer(source);
    beginTransfer({ ...source, key: 'k2', fileId: 'f2' });

    advanceTransfer('k2', 'uploading', 40);

    expect(transfersInFlight().map((transfer) => transfer.percent)).toEqual([0, 40]);
  });

  it('keeps a failure in the list, because the user has to be told', () => {
    beginTransfer(source);
    failTransfer('k1', 'Failed to fetch');

    expect(transfersInFlight()[0]).toMatchObject({ phase: 'failed', error: 'Failed to fetch' });
  });

  it('is gone once it is dropped', () => {
    beginTransfer(source);
    dropTransfer('k1');

    expect(transfersInFlight()).toEqual([]);
  });

  it('cannot be resurrected by a late progress report', () => {
    beginTransfer(source);
    dropTransfer('k1');

    advanceTransfer('k1', 'uploading', 90);
    failTransfer('k1', 'too late');

    expect(transfersInFlight()).toEqual([]);
  });
});

describe('the store outlives whoever is watching it', () => {
  it('hands back the same array until something changes', () => {
    beginTransfer(source);
    const first = transfersInFlight();

    expect(transfersInFlight()).toBe(first);

    advanceTransfer('k1', 'uploading', 10);
    expect(transfersInFlight()).not.toBe(first);
  });

  it('tells every subscriber, and stops once one leaves', () => {
    const stay = vi.fn();
    const leave = vi.fn();
    subscribeToTransfers(stay);
    const unsubscribe = subscribeToTransfers(leave);

    beginTransfer(source);
    unsubscribe();
    advanceTransfer('k1', 'uploading', 50);

    expect(stay).toHaveBeenCalledTimes(2);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('survives a subscriber leaving and coming back, which is what a tab change is', () => {
    const unsubscribe = subscribeToTransfers(() => {});
    beginTransfer(source);
    advanceTransfer('k1', 'uploading', 70);
    unsubscribe();

    advanceTransfer('k1', 'completing', 100);

    const seen: unknown[] = [];
    subscribeToTransfers(() => seen.push(transfersInFlight()));

    expect(transfersInFlight()[0]).toMatchObject({ phase: 'completing', percent: 100 });
    expect(seen).toEqual([]);
  });
});
