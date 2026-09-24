'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent } from 'react';
import { ApiError } from '@/lib/api';
import {
  abandonUpload,
  chooseSources,
  deleteFiles,
  deriveThumbnail,
  downloadFile,
  droppedSources,
  openPreview,
  pruneCachedObjects,
  forgetSource,
  forgetSourcesExcept,
  getStorageUsage,
  listFiles,
  openManifest,
  openRememberedSource,
  recallSource,
  rememberSource,
  rememberedSourceIds,
  resumeUpload,
  thumbnailIdsOf,
  uploadFile,
  uploadThumbnail,
  wrapper,
  type FileRecord,
  type ResumableFile,
  type UploadSource,
} from '@/lib/files';
import { moveItemsToFolder } from '@/lib/folders';
import {
  advanceTransfer,
  beginTransfer,
  dropTransfer,
  failTransfer,
  creationPauseSeconds,
  pauseTransfer,
  pausedUploadNote,
  discardConfirmation,
  fileBatchDeleteConfirmation,
  fileBatchDeleteSummary,
  fileCaption,
  fileCountLabel,
  fileExtension,
  fileDeleteConfirmation,
  FILE_NOUNS,
  fileKind,
  fileName,
  defaultIconSize,
  gridTemplate,
  hasPreview,
  iconScale,
  isOpenable,
  isResumable,
  previewUrls,
  readIconSize,
  replicationLabel,
  resumeHint,
  retainSelectable,
  setPreview,
  setStorageUsage,
  storageFullMessage,
  storageUsage,
  subscribeToPreviews,
  subscribeToStorageUsage,
  subscribeToTransfers,
  toggleFileSelection,
  transferLabel,
  transfersInFlight,
  uploadPercent,
  writeIconSize,
  type FileKind,
  type IconScale,
  type IconSize,
  type Transfer,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  DriveIcon,
  FileTypeIcon,
  SharingIcon,
  TrashIcon,
  UploadIcon,
} from './icons';
import { Button, Card, Empty, FloatingAddButton, Notice, SizeStepper, Spinner } from './ui';
import ShareItemDialog from './ShareItemDialog';
import { startItemDrag } from './FolderTabs';
import { FolderPath, FolderTile, isFileDrop, MoveToFolder, useFolderTree } from './FolderBrowser';

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
  resume?: ResumableFile;
  remembered: boolean;
  placeholder?: boolean;
  thumbnailId?: string;
}

export default function DriveScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();

  const [tiles, setTiles] = useState<DriveTile[]>();
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'danger' }>();
  const [unavailable, setUnavailable] = useState(false);
  const [confirming, setConfirming] = useState<DriveTile>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sharing, setSharing] = useState<string>();
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [iconSize, setIconSize] = useState<IconSize>(defaultIconSize('drive'));

  useEffect(() => setIconSize(readIconSize('drive')), []);

  const resize = useCallback((next: IconSize) => {
    setIconSize(next);
    writeIconSize('drive', next);
  }, []);

  const transfers = useSyncExternalStore(
    subscribeToTransfers,
    transfersInFlight,
    transfersInFlight,
  );

  const usage = useSyncExternalStore(subscribeToStorageUsage, storageUsage, storageUsage);

  const picker = useRef<HTMLInputElement>(null);
  const resumePicker = useRef<HTMLInputElement>(null);
  const resuming = useRef<DriveTile>(undefined);
  const derivatives = useRef(new Map<string, FileRecord>());

  const reloadFiles = useRef<() => void>(() => undefined);
  const itemsChanged = useCallback(() => reloadFiles.current(), []);
  const tree = useFolderTree('files', itemsChanged);
  const listing = tree.listing;
  const openFolder = tree.current;

  useEffect(() => {
    void (async () => {
      try {
        const everything = await listFiles(context);
        await forgetSourcesExcept(everything.filter(isResumable).map((record) => record.id));
        void pruneCachedObjects(new Set(everything.map((record) => record.id)));
      } catch {
        return;
      }
    })();
  }, [context]);

  const load = useCallback(async () => {
    if (listing === undefined) {
      return;
    }
    try {
      const [records, storage] = await Promise.all([
        listFiles(context, { folder: listing === '' ? undefined : listing }),
        getStorageUsage(context),
      ]);

      const remembered = new Set(await rememberedSourceIds());

      const opened = await Promise.all(
        records.map((record) => toTile(context, record, remembered.has(record.id))),
      );
      const previewIds = thumbnailIdsOf(opened.map((tile) => ({ thumbnail_id: tile.thumbnailId })));

      derivatives.current = new Map(
        records.filter((record) => previewIds.has(record.id)).map((record) => [record.id, record]),
      );

      setTiles(opened.filter((tile) => !previewIds.has(tile.id)));
      setStorageUsage(storage);
      setMessage(undefined);
      setSelected((current) =>
        retainSelectable(
          current,
          records.map((record) => record.id),
        ),
      );
    } catch (error) {
      if (error instanceof ApiError && error.isDriveDisabled) {
        setUnavailable(true);
        setTiles([]);
        return;
      }
      setMessage({ text: reportError(error), tone: 'danger' });
      setTiles([]);
    }
  }, [context, reportError, listing]);

  useEffect(() => {
    reloadFiles.current = () => void load();
  }, [load]);

  useEffect(() => {
    setSelecting(false);
    setSelected([]);
    setConfirmingBatch(false);
    void load();
  }, [load]);

  const withTheirThumbnails = useCallback(
    (ids: string[]) => {
      const chosen = (tiles ?? []).filter((tile) => ids.includes(tile.id));
      return chosen.length === 0 ? ids : withThumbnails(chosen);
    },
    [tiles],
  );

  const previews = useSyncExternalStore(subscribeToPreviews, previewUrls, previewUrls);

  useEffect(() => {
    const wanted = (tiles ?? [])
      .map((tile) => tile.thumbnailId)
      .filter((id): id is string => id !== undefined && !hasPreview(id));

    if (wanted.length === 0) {
      return;
    }

    let live = true;
    void (async () => {
      for (const id of wanted) {
        if (!live) {
          return;
        }
        const record = derivatives.current.get(id);
        if (record === undefined) {
          continue;
        }

        try {
          const preview = await openPreview(context, record);
          setPreview(
            id,
            URL.createObjectURL(new Blob([preview.bytes as BlobPart], { type: preview.mime })),
          );
        } catch {
          setPreview(id, '');
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [context, tiles]);

  const send = useCallback(
    async (sources: readonly UploadSource[]) => {
      const destination = openFolder;
      for (const { file, handle } of sources) {
        const id = crypto.randomUUID();
        const key = `${file.name}:${id}`;
        beginTransfer({ key, fileId: id, name: file.name, mime: file.type, bytes: file.size });

        if (handle !== undefined) {
          await rememberSource(id, handle);
        }

        let stored = 0;
        const preview = await deriveThumbnail(file);
        const thumbnailId = preview === undefined ? undefined : crypto.randomUUID();

        const afterPauses = async <T,>(attempt: () => Promise<T>): Promise<T> => {
          for (;;) {
            try {
              return await attempt();
            } catch (error) {
              const pause = creationPauseSeconds(error);
              if (pause === undefined) {
                throw error;
              }
              pauseTransfer(key, pausedUploadNote(pause));
              await new Promise((resolve) => setTimeout(resolve, pause * 1000));
              advanceTransfer(key, 'uploading', 0);
            }
          }
        };

        try {
          await afterPauses(() =>
            uploadFile(context, file, {
              id,
              thumbnailId,
              onProgress: ({ phase, doneBytes, totalBytes }) => {
                stored = doneBytes;
                advanceTransfer(key, phase, uploadPercent(doneBytes, totalBytes));
              },
            }),
          );

          if (preview !== undefined && thumbnailId !== undefined) {
            await afterPauses(() => uploadThumbnail(context, preview, thumbnailId));
          }

          if (destination !== null) {
            await moveItemsToFolder(
              context,
              'files',
              thumbnailId === undefined ? [id] : [id, thumbnailId],
              destination,
            );
          }

          await forgetSource(id);
          dropTransfer(key);
        } catch (error) {
          const text =
            error instanceof ApiError && error.isQuotaExceeded && usage !== undefined
              ? storageFullMessage(usage, file.size)
              : reportError(error);

          failTransfer(key, text);

          if (stored === 0) {
            await forgetSource(id);
            await abandonUpload(context, id).catch(() => undefined);
          }
        }
      }

      await load();
    },
    [context, load, openFolder, reportError, usage],
  );

  const carryOn = useCallback(
    async (tile: DriveTile, source: File) => {
      if (tile.resume === undefined) {
        return;
      }

      const key = `${tile.id}:${crypto.randomUUID()}`;
      beginTransfer({
        key,
        fileId: tile.id,
        name: tile.name,
        mime: tile.mime,
        bytes: tile.trueBytes,
      });

      try {
        await resumeUpload(context, tile.resume, source, {
          onProgress: ({ phase, doneBytes, totalBytes }) =>
            advanceTransfer(key, phase, uploadPercent(doneBytes, totalBytes)),
        });

        await forgetSource(tile.id);
        dropTransfer(key);
      } catch (error) {
        failTransfer(key, reportError(error));
      }

      await load();
    },
    [context, load, reportError],
  );

  const choose = useCallback(async () => {
    const chosen = await chooseSources(true);
    if (chosen === undefined) {
      picker.current?.click();
      return;
    }

    await send(chosen);
  }, [send]);

  const resume = useCallback(
    async (tile: DriveTile) => {
      const handle = tile.remembered ? await recallSource(tile.id) : undefined;
      const source = handle === undefined ? undefined : await openRememberedSource(handle);

      if (source === undefined) {
        resuming.current = tile;
        resumePicker.current?.click();
        return;
      }

      await carryOn(tile, source);
    },
    [carryOn],
  );

  const save = useCallback(
    async (tile: DriveTile) => {
      setBusy(true);
      try {
        const { manifest, bytes } = await downloadFile(context, tile.id);
        offerDownload(manifest.name, manifest.mime, bytes);
      } catch (error) {
        setMessage({ text: reportError(error), tone: 'danger' });
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
    const unfinished = confirming.resume !== undefined;

    setBusy(true);
    try {
      if (unfinished) {
        await abandonUpload(context, confirming.id);
      } else {
        await deleteFiles(context, withThumbnails([confirming]));
      }
      await forgetSource(confirming.id);
      for (const transfer of transfersInFlight()) {
        if (transfer.fileId === confirming.id) {
          dropTransfer(transfer.key);
        }
      }
      setConfirming(undefined);
      await load();
    } catch (error) {
      setMessage({ text: reportError(error), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [confirming, context, load, reportError]);

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected([]);
    setConfirmingBatch(false);
  }, []);

  const removeSelected = useCallback(async () => {
    setBusy(true);
    try {
      const chosen = (tiles ?? []).filter((tile) => selected.includes(tile.id));
      const result = await deleteFiles(context, withThumbnails(chosen));
      await Promise.all(selected.map((id) => forgetSource(id)));
      stopSelecting();
      await load();

      const summary = fileBatchDeleteSummary(result);
      if (summary !== undefined) {
        setMessage({ text: summary, tone: 'info' });
      }
    } catch (error) {
      setMessage({ text: reportError(error), tone: 'danger' });
      setConfirmingBatch(false);
    } finally {
      setBusy(false);
    }
  }, [context, load, reportError, selected, stopSelecting, tiles]);

  const byFile = useMemo(() => {
    const latest = new Map<string, Transfer>();
    for (const transfer of transfers) {
      latest.set(transfer.fileId, transfer);
    }

    return latest;
  }, [transfers]);

  const grid = useMemo(() => {
    const rows = tiles ?? [];
    const shown = new Set(rows.map((tile) => tile.id));
    const waiting = transfers
      .filter((transfer) => !shown.has(transfer.fileId))
      .map(placeholderTile);

    return [...waiting, ...rows];
  }, [tiles, transfers]);

  if (tiles === undefined) {
    return <Spinner />;
  }

  const folderTiles = tree.invalid ? [] : tree.children;

  if (unavailable) {
    return (
      <Card>
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
        if (!isFileDrop(event)) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event: DragEvent) => {
        if (!isFileDrop(event)) {
          return;
        }
        event.preventDefault();
        setDragging(false);
        void droppedSources(event.dataTransfer).then(send);
      }}
    >
      <FolderPath
        state={tree}
        rootLabel="Drive"
        rootIcon={<DriveIcon className="h-4 w-4 shrink-0" />}
        itemIdsFor={withTheirThumbnails}
      />

      {message !== undefined && <Notice tone={message.tone}>{message.text}</Notice>}

      {sharing ? (
        <ShareItemDialog itemType="file" itemId={sharing} onClose={() => setSharing(undefined)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-compact text-ink-muted" aria-live="polite">
            {selecting
              ? `${selected.length} selected`
              : grid.length > 0
                ? fileCountLabel(grid.length)
                : openFolder === null
                  ? 'No files yet'
                  : 'No files in this folder'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void send([...(event.target.files ?? [])].map((file) => ({ file })));
              event.target.value = '';
            }}
          />
          <input
            ref={resumePicker}
            type="file"
            className="hidden"
            onChange={(event) => {
              const tile = resuming.current;
              const source = event.target.files?.[0];
              event.target.value = '';
              resuming.current = undefined;
              if (tile !== undefined && source !== undefined) {
                void carryOn(tile, source);
              }
            }}
          />
          {grid.length + folderTiles.length > 0 && (
            <SizeStepper
              size={iconSize}
              onChange={resize}
              groupLabel="Icon size"
              smallerLabel="Smaller icons"
              largerLabel="Larger icons"
            />
          )}
          {selecting ? (
            <>
              <MoveToFolder
                state={tree}
                itemIds={withTheirThumbnails(selected)}
                rootLabel="Drive"
              />
              <Button
                variant="secondary"
                disabled={busy || selected.length === tiles.length}
                onClick={() => setSelected(tiles.map((tile) => tile.id))}
              >
                Select all
              </Button>
              <Button variant="secondary" disabled={busy} onClick={stopSelecting}>
                Cancel
              </Button>
              {fullDevice ? (
                <Button
                  variant="danger"
                  disabled={busy || selected.length === 0}
                  onClick={() => setConfirmingBatch(true)}
                >
                  <TrashIcon className="h-4 w-4" />
                  {busy ? 'Deleting…' : `Delete${selected.length > 0 ? ` (${selected.length})` : ''}`}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {tiles.length > 0 && (
                <Button variant="secondary" disabled={busy} onClick={() => setSelecting(true)}>
                  Select
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {confirmingBatch && selected.length > 0 && (
        <Notice tone="danger">
          <p>{fileBatchDeleteConfirmation(selected.length)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void removeSelected()}>
              {busy ? 'Deleting…' : `Delete ${fileCountLabel(selected.length)}`}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmingBatch(false)}>
              Keep them
            </Button>
          </div>
        </Notice>
      )}

      {confirming !== undefined && (
        <Notice tone="warning">
          <p>
            {confirming.resume !== undefined
              ? discardConfirmation(confirming.name)
              : fileDeleteConfirmation(confirming.name)}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {confirming.resume !== undefined ? 'Discard the upload' : 'Delete permanently'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(undefined)}>
              {confirming.resume !== undefined ? 'Keep it for now' : 'Keep it'}
            </Button>
          </div>
        </Notice>
      )}

      {grid.length === 0 && folderTiles.length === 0 ? (
        <Card>
          <Empty icon={<DriveIcon className="h-6 w-6" />}>
            {dragging
              ? 'Drop the files here.'
              : openFolder === null
                ? 'Nothing here yet. Drop a file anywhere on this page, or use Upload — it is encrypted on this device before it is stored.'
                : 'This folder is empty. Drop files here to upload them into it, or drag files onto it from elsewhere.'}
          </Empty>
        </Card>
      ) : (
        <ul
          className="grid gap-1"
          style={{ gridTemplateColumns: gridTemplate('drive', iconSize) }}
        >
          {folderTiles.map((folder) => (
            <FolderTile
              key={folder.id}
              state={tree}
              folder={folder}
              nouns={FILE_NOUNS}
              glyphPixels={iconScale(iconSize).glyphPixels}
              itemIdsFor={withTheirThumbnails}
            />
          ))}
          {grid.map((tile) => {
            const transfer = byFile.get(tile.id);

            return (
              <DriveFile
                key={tile.id}
                tile={tile}
                scale={iconScale(iconSize)}
                busy={busy}
                transfer={transfer}
                preview={tile.thumbnailId === undefined ? undefined : previews.get(tile.thumbnailId)}
                selecting={selecting}
                selected={selected.includes(tile.id)}
                onOpen={() => {
                  if (selecting) {
                    setSelected((current) => toggleFileSelection(current, tile.id));
                    return;
                  }
                  void save(tile);
                }}
                onToggle={() => {
                  setSelecting(true);
                  setSelected((current) => toggleFileSelection(current, tile.id));
                }}
                onDelete={
                  fullDevice || tile.resume !== undefined ? () => setConfirming(tile) : undefined
                }
                onShare={() => setSharing(tile.id)}
                onDragStart={(event) =>
                  startItemDrag(
                    event,
                    withTheirThumbnails(selected.includes(tile.id) ? selected : [tile.id]),
                  )
                }
                onResume={() => void resume(tile)}
                onDismiss={transfer === undefined ? undefined : () => dropTransfer(transfer.key)}
              />
            );
          })}
        </ul>
      )}

      {dragging && grid.length > 0 && (
        <p className="text-compact text-brand-700">Drop the files here.</p>
      )}

      {selecting ? null : (
        <FloatingAddButton
          label="Upload files"
          spread
          disabled={busy}
          onClick={() => void choose()}
        />
      )}
    </div>
  );
}

function DriveFile({
  tile,
  scale,
  busy,
  transfer,
  preview,
  selecting,
  selected,
  onOpen,
  onToggle,
  onDelete,
  onShare,
  onDragStart,
  onResume,
  onDismiss,
}: {
  tile: DriveTile;
  scale: IconScale;
  busy: boolean;
  transfer?: Transfer;
  preview?: string;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDelete?: () => void;
  onShare: () => void;
  onDragStart: (event: DragEvent) => void;
  onResume: () => void;
  onDismiss?: () => void;
}) {
  const failed = transfer?.phase === 'failed';
  const running = transfer !== undefined && !failed;
  const inert = running || tile.placeholder === true;
  const showing = preview !== undefined && preview !== '';

  return (
    <li className="group relative" draggable={!busy && !inert} onDragStart={onDragStart}>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy || inert || (!selecting && !tile.openable)}
        title={failed ? transfer.error : tile.status}
        aria-label={
          selecting ? `${selected ? 'Deselect' : 'Select'} ${tile.name}` : `Download ${tile.name}`
        }
        className={`flex w-full flex-col items-center gap-1.5 rounded-lg p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-60 ${
          selected ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-raised'
        }`}
      >
        <span
          className="flex flex-col items-center justify-end gap-1"
          style={{ width: scale.glyphPixels }}
        >
          <span
            className="flex items-end justify-center"
            style={{ height: scale.glyphPixels, width: scale.glyphPixels }}
          >
            {showing ? (
              <img
                src={preview}
                alt=""
                loading="lazy"
                className="max-h-full max-w-full rounded-sm bg-surface object-contain shadow-card ring-1 ring-line"
              />
            ) : (
              <FileTypeIcon
                kind={tile.kind}
                extension={tile.readable ? fileExtension(tile.name) : ''}
                labelled={scale.labelsTheGlyph}
              />
            )}
          </span>
          {running && (
            <span
              role="progressbar"
              aria-label={`Uploading ${tile.name}`}
              aria-valuenow={transfer.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="block h-1 w-full overflow-hidden rounded-full bg-line"
            >
              <span
                style={{ width: `${transfer.percent}%` }}
                className="block h-full bg-brand-500 transition-all duration-200"
              />
            </span>
          )}
          {failed && <span className="block h-1 w-full rounded-full bg-danger" />}
        </span>

        <span className="block w-full min-w-0">
          <span className="line-clamp-2 block break-words text-compact font-medium text-ink">
            {tile.name}
          </span>
          <span
            className={`mt-0.5 block text-caption normal-case tracking-normal ${
              failed ? 'line-clamp-3 text-danger' : 'truncate'
            } ${running ? 'text-brand-700' : failed ? '' : 'text-ink-muted'}`}
          >
            {transfer === undefined
              ? fileCaption(tile.status, tile.trueBytes)
              : transfer.phase === 'failed'
                ? transfer.error
                : transfer.phase === 'paused'
                  ? transfer.note
                  : transferLabel(transfer.phase, transfer.percent)}
          </span>
        </span>
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${selected ? 'Deselect' : 'Select'} ${tile.name}`}
        disabled={busy || inert}
        onClick={onToggle}
        className={`absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-md border shadow-card transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
          selected
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-line-strong bg-surface/90 text-transparent hover:border-brand-400'
        } ${selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <CheckIcon className="h-3.5 w-3.5 shrink-0" />
      </button>

      <div
        hidden={selecting || running}
        className={`absolute right-1 top-1 z-10 flex gap-1 transition ${
          failed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        {tile.openable && (
          <button
            type="button"
            aria-label={`Download ${tile.name}`}
            disabled={busy}
            onClick={onOpen}
            className="flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-brand-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <DownloadIcon className="h-3 w-3 shrink-0" />
          </button>
        )}
        {tile.openable && (
          <button
            type="button"
            aria-label={`Share ${tile.name}`}
            disabled={busy}
            onClick={onShare}
            className="flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-brand-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <SharingIcon className="h-3 w-3 shrink-0" />
          </button>
        )}
        {tile.resume !== undefined && (
          <button
            type="button"
            aria-label={`Finish uploading ${tile.name}`}
            title={resumeHint(tile.name, tile.remembered)}
            disabled={busy}
            onClick={onResume}
            className="flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-brand-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <UploadIcon className="h-3 w-3 shrink-0" />
          </button>
        )}
        {tile.placeholder !== true && onDelete !== undefined && (
          <button
            type="button"
            aria-label={
              tile.resume === undefined ? `Delete ${tile.name}` : `Discard ${tile.name}`
            }
            title={
              tile.resume === undefined
                ? undefined
                : 'Discard this unfinished upload and free the space it is holding'
            }
            disabled={busy}
            onClick={onDelete}
            className="flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <TrashIcon className="h-3 w-3 shrink-0" />
          </button>
        )}
        {failed && onDismiss !== undefined && (
          <button
            type="button"
            aria-label={`Dismiss ${tile.name}`}
            onClick={onDismiss}
            className="flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-surface/90 text-ink-soft shadow-card transition hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <CloseIcon className="h-3 w-3 shrink-0" />
          </button>
        )}
      </div>
    </li>
  );
}

function withThumbnails(chosen: readonly DriveTile[]): string[] {
  const ids: string[] = [];
  for (const tile of chosen) {
    ids.push(tile.id);
    if (tile.thumbnailId !== undefined) {
      ids.push(tile.thumbnailId);
    }
  }

  return ids;
}

function placeholderTile(transfer: Transfer): DriveTile {
  return {
    id: transfer.fileId,
    name: fileName(transfer.name),
    mime: transfer.mime,
    kind: fileKind(transfer.mime),
    storedBytes: transfer.bytes,
    trueBytes: transfer.bytes,
    status: '',
    openable: false,
    readable: true,
    updatedAt: '',
    remembered: false,
    placeholder: true,
  };
}

async function toTile(
  context: Parameters<typeof wrapper>[0],
  record: FileRecord,
  remembered: boolean,
): Promise<DriveTile> {
  const base = {
    id: record.id,
    storedBytes: record.size_bytes,
    status: replicationLabel(record),
    openable: isOpenable(record),
    updatedAt: record.updated_at,
    remembered: remembered && isResumable(record),
    resume: isResumable(record)
      ? {
          id: record.id,
          ciphertext: record.ciphertext,
          key_generation: record.key_generation,
          wrapped_dek: record.wrapped_dek,
          size_bytes: record.size_bytes,
        }
      : undefined,
  };

  try {
    const dek = await wrapper(context).unwrapDek(record);
    const manifest = await openManifest(record.ciphertext, dek);

    return {
      ...base,
      name: fileName(manifest.name),
      mime: manifest.mime,
      kind: fileKind(manifest.mime),
      trueBytes: manifest.size,
      readable: true,
      thumbnailId: manifest.thumbnail_id,
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
