'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';
import { countStoredFiles, getStorageUsage } from '@/lib/files';
import {
  formatBytes,
  freeBytes,
  setStorageUsage,
  storageBar,
  storageUsage,
  subscribeToStorageUsage,
  usedShareLabel,
} from '@/lib/app';
import { useAuthedContext } from '@/components/session/CrypleProvider';

export default function HomeStorage() {
  const context = useAuthedContext();
  const usage = useSyncExternalStore(subscribeToStorageUsage, storageUsage, storageUsage);
  const [files, setFiles] = useState<number>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [reading, count] = await Promise.all([getStorageUsage(context), countStoredFiles(context)]);
        if (live) {
          setStorageUsage(reading);
          setFiles(count);
        }
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        if (live && error.isDriveDisabled) {
          setUnavailable(true);
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [context]);

  if (unavailable || usage === undefined) {
    return null;
  }

  const bar = storageBar(usage);
  const tone = bar.nearlyFull ? 'bg-warning' : 'bg-brand-500';

  return (
    <section aria-labelledby="home-storage" className="space-y-4">
      <h2 id="home-storage" className="text-title text-ink">
        Storage
      </h2>

      <dl className="grid grid-cols-3 gap-4">
        <StorageFact label="Used" value={bar.usedLabel} detail={usedShareLabel(usage)} />
        <StorageFact
          label="Free"
          value={formatBytes(freeBytes(usage))}
          detail={bar.uploadingSummary ?? 'Ready for new files'}
          warning={bar.nearlyFull}
        />
        <StorageFact
          label="Files"
          value={files === undefined ? '…' : files.toLocaleString()}
          detail={files === 1 ? 'file in the drive' : 'files in the drive'}
        />
      </dl>

      <div
        role="progressbar"
        aria-label="Storage used"
        aria-valuenow={bar.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-2 w-full overflow-hidden rounded-full bg-line"
      >
        <span style={{ width: `${bar.percent}%` }} className={`h-full ${tone}`} />
        <span style={{ width: `${bar.reservedPercent}%` }} className={`h-full opacity-40 ${tone}`} />
      </div>
    </section>
  );
}

function StorageFact({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-caption uppercase text-ink-muted">{label}</dt>
      <dd className={`mt-1 truncate text-headline tabular-nums sm:text-headline-lg ${warning ? 'text-warning' : 'text-ink'}`}>
        {value}
      </dd>
      <dd className="mt-0.5 truncate text-caption normal-case tracking-normal text-ink-muted">{detail}</dd>
    </div>
  );
}
