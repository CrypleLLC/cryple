'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ApiError } from '@/lib/api';
import {
  deleteFile,
  downloadFile,
  getStorageUsage,
  listFiles,
  openManifest,
  uploadFile,
  wrapper,
  type FileRecord,
  type StorageUsage,
  type UploadProgress,
} from '@/lib/files';
import {
  fileCountLabel,
  fileDeleteConfirmation,
  fileKind,
  fileName,
  formatBytes,
  isOpenable,
  replicationLabel,
  storageBar,
  storageFullMessage,
  uploadPercent,
  type FileKind,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { DocumentsIcon, DownloadIcon, DriveIcon, TrashIcon, UploadIcon } from './icons';
import { Button, Card, Empty, Notice, Spinner } from './ui';

interface DriveTile {
  id: string;
  name: string;
  mime: string;
  kind: FileKind;
  storedBytes: number;
  trueBytes: number;
  status: string;
  openable: boolean;
  readable: boolean;
  updatedAt: string;
}

interface Transfer {
  key: string;
  name: string;
  percent: number;
  phase: UploadProgress['phase'] | 'failed';
  error?: string;
}

export default function DriveScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [tiles, setTiles] = useState<DriveTile[]>();
  const [usage, setUsage] = useState<StorageUsage>();
  const [message, setMessage] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [confirming, setConfirming] = useState<DriveTile>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [records, storage] = await Promise.all([
        listFiles(context),
        getStorageUsage(context),
      ]);

      setTiles(await Promise.all(records.map((record) => toTile(context, record))));
      setUsage(storage);
      setMessage(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.isDriveDisabled) {
        setUnavailable(true);
        setTiles([]);
        return;
      }
      setMessage(reportError(error));
      setTiles([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (files: readonly File[]) => {
      for (const file of files) {
        const key = `${file.name}:${crypto.randomUUID()}`;
        setTransfers((current) => [
          ...current,
          { key, name: file.name, percent: 0, phase: 'sealing' },
        ]);

        try {
          await uploadFile(context, file, {
            onProgress: ({ phase, doneBytes, totalBytes }) =>
              setTransfers((current) =>
                current.map((transfer) =>
                  transfer.key === key
                    ? { ...transfer, phase, percent: uploadPercent(doneBytes, totalBytes) }
                    : transfer,
                ),
              ),
          });

          setTransfers((current) => current.filter((transfer) => transfer.key !== key));
        } catch (error) {
          const text =
            error instanceof ApiError && error.isQuotaExceeded && usage !== undefined
              ? storageFullMessage(usage, file.size)
              : reportError(error);

          setTransfers((current) =>
            current.map((transfer) =>
              transfer.key === key ? { ...transfer, phase: 'failed', error: text } : transfer,
            ),
          );
        }
      }

      await load();
    },
    [context, load, reportError, usage],
  );

  const save = useCallback(
    async (tile: DriveTile) => {
      setBusy(true);
      try {
        const { manifest, bytes } = await downloadFile(context, tile.id);
        offerDownload(manifest.name, manifest.mime, bytes);
      } catch (error) {
        setMessage(reportError(error));
      } finally {
        setBusy(false);
      }
    },
    [context, reportError],
  );

  const remove = useCallback(async () => {
    if (confirming === undefined) {
      return;
    }
    setBusy(true);
    try {
      await deleteFile(context, confirming.id);
      setConfirming(undefined);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }, [confirming, context, load, reportError]);

  const bar = useMemo(() => (usage === undefined ? undefined : storageBar(usage)), [usage]);

  if (tiles === undefined) {
    return <Spinner />;
  }

  if (unavailable) {
    return (
      <Card flush>
        <Empty icon={<DriveIcon className="h-6 w-6" />}>
          The drive is not switched on for this deployment.
        </Empty>
      </Card>
    );
  }

  return (
    <div
      className="space-y-5"
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        setDragging(false);
        void send([...event.dataTransfer.files]);
      }}
    >
      {message !== undefined && <Notice tone="danger">{message}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-compact text-ink-muted">
            {tiles.length === 0 ? 'No files yet' : fileCountLabel(tiles.length)}
          </p>
          {bar !== undefined && (
            <div className="mt-1.5 w-56">
              <div
                role="progressbar"
                aria-label="Storage used"
                aria-valuenow={bar.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 w-full overflow-hidden rounded-full bg-line"
              >
                <div
                  style={{ width: `${bar.percent}%` }}
                  className={`h-full rounded-full ${bar.nearlyFull ? 'bg-warning' : 'bg-brand-500'}`}
                />
              </div>
              <p className="mt-1 text-caption normal-case tracking-normal text-ink-muted">
                {bar.summary}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void send([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <Button variant="accent" disabled={busy} onClick={() => picker.current?.click()}>
            <UploadIcon className="h-4 w-4" />
            Upload
          </Button>
        </div>
      </div>

      {transfers.length > 0 && (
        <Card>
          <ul className="space-y-3">
            {transfers.map((transfer) => (
              <li key={transfer.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-compact text-ink">{transfer.name}</span>
                  <span className="shrink-0 text-caption normal-case tracking-normal text-ink-muted">
                    {transfer.phase === 'failed' ? 'Failed' : `${transfer.phase} · ${transfer.percent}%`}
                  </span>
                </div>
                {transfer.phase === 'failed' ? (
                  <p className="mt-1 text-caption normal-case tracking-normal text-danger">
                    {transfer.error}
                  </p>
                ) : (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
                    <div
                      style={{ width: `${transfer.percent}%` }}
                      className="h-full rounded-full bg-brand-500 transition-all"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirming !== undefined && (
        <Notice tone="warning">
          <p>{fileDeleteConfirmation(confirming.name)}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              Delete permanently
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(undefined)}>
              Keep it
            </Button>
          </div>
        </Notice>
      )}

      {tiles.length === 0 ? (
        <Card flush>
          <Empty icon={<DriveIcon className="h-6 w-6" />}>
            {dragging
              ? 'Drop the files here.'
              : 'Nothing here yet. Drop a file anywhere on this page, or use Upload — it is encrypted on this device before it is stored.'}
          </Empty>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {tiles.map((tile) => (
            <DriveFile
              key={tile.id}
              tile={tile}
              busy={busy}
              onOpen={() => void save(tile)}
              onDelete={() => setConfirming(tile)}
            />
          ))}
        </ul>
      )}

      {dragging && tiles.length > 0 && (
        <p className="text-compact text-brand-700">Drop the files here.</p>
      )}
    </div>
  );
}

function DriveFile({
  tile,
  busy,
  onOpen,
  onDelete,
}: {
  tile: DriveTile;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy || !tile.openable}
        title={tile.status}
        aria-label={`Download ${tile.name}`}
        className="flex w-full flex-col gap-2.5 rounded-xl p-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-60"
      >
        <span className="relative flex aspect-[210/297] w-full items-center justify-center overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-line transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lift group-hover:ring-brand-200">
          <KindGlyph kind={tile.kind} readable={tile.readable} />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
            <span className="rounded-full bg-raised px-2 py-0.5 text-caption normal-case tracking-normal text-ink-muted">
              {formatBytes(tile.trueBytes)}
            </span>
          </span>
        </span>

        <span className="block min-w-0 px-0.5">
          <span className="block truncate text-compact font-semibold text-ink">{tile.name}</span>
          <span className="mt-0.5 block truncate text-caption normal-case tracking-normal text-ink-muted">
            {tile.status}
          </span>
        </span>
      </button>

      <div className="absolute right-3 top-3 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        {tile.openable && (
          <button
            type="button"
            aria-label={`Download ${tile.name}`}
            disabled={busy}
            onClick={onOpen}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-brand-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <DownloadIcon className="h-3.5 w-3.5 shrink-0" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Delete ${tile.name}`}
          disabled={busy}
          onClick={onDelete}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <TrashIcon className="h-3.5 w-3.5 shrink-0" />
        </button>
      </div>
    </li>
  );
}

function KindGlyph({ kind, readable }: { kind: FileKind; readable: boolean }) {
  if (!readable) {
    return <DocumentsIcon className="h-8 w-8 text-ink-faint" />;
  }

  return (
    <span className="flex flex-col items-center gap-1.5 text-ink-faint">
      <DriveIcon className="h-8 w-8" />
      <span className="text-caption tracking-widest">{kind}</span>
    </span>
  );
}

async function toTile(
  context: Parameters<typeof wrapper>[0],
  record: FileRecord,
): Promise<DriveTile> {
  const base = {
    id: record.id,
    storedBytes: record.size_bytes,
    status: replicationLabel(record),
    openable: isOpenable(record),
    updatedAt: record.updated_at,
  };

  try {
    const dek = await wrapper(context).unwrapDek(record.wrapped_dek);
    const manifest = await openManifest(record.ciphertext, dek);

    return {
      ...base,
      name: fileName(manifest.name),
      mime: manifest.mime,
      kind: fileKind(manifest.mime),
      trueBytes: manifest.size,
      readable: true,
    };
  } catch {
    return {
      ...base,
      name: fileName(''),
      mime: '',
      kind: 'other',
      trueBytes: record.size_bytes,
      readable: false,
      openable: false,
    };
  }
}

function offerDownload(name: string, mime: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
