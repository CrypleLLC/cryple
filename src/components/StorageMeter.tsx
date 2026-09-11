'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';
import { getStorageUsage } from '@/lib/files';
import { setStorageUsage, storageBar, storageUsage, subscribeToStorageUsage } from '@/lib/app';
import { useAuthedContext } from './CrypleProvider';

export default function StorageMeter() {
  const context = useAuthedContext();
  const usage = useSyncExternalStore(subscribeToStorageUsage, storageUsage, storageUsage);

  useEffect(() => {
    if (usage !== undefined) {
      return;
    }

    let live = true;
    void (async () => {
      try {
        const reading = await getStorageUsage(context);
        if (live) {
          setStorageUsage(reading);
        }
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [context, usage]);

  if (usage === undefined) {
    return null;
  }

  const bar = storageBar(usage);

  return (
    <div className="mt-4 px-2">
      <div
        role="progressbar"
        aria-label="Storage used"
        aria-valuenow={bar.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-line"
      >
        <span
          style={{ width: `${bar.percent}%` }}
          className={`h-full ${bar.nearlyFull ? 'bg-warning' : 'bg-brand-500'}`}
        />
        <span
          style={{ width: `${bar.reservedPercent}%` }}
          className={`h-full opacity-40 ${bar.nearlyFull ? 'bg-warning' : 'bg-brand-500'}`}
        />
      </div>
      <p className="mt-1.5 text-caption normal-case tracking-normal text-ink-muted">
        {bar.summary}
      </p>
      {bar.uploadingSummary !== undefined && (
        <p className="text-caption normal-case tracking-normal text-brand-700">
          {bar.uploadingSummary}
        </p>
      )}
    </div>
  );
}
