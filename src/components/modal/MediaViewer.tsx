'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { zeroBytes } from '@/lib/encoding';
import { DownloadBufferExceededError } from '@/lib/files';
import {
  loadingLabel,
  mediaPosition,
  stepMedia,
  VIEWER_COPY,
  viewerKeyAction,
  type ViewableMedia,
} from '@/lib/app';
import { ArrowLeftIcon, CloseIcon, DownloadIcon } from '@/components/ui/icons';
import { trapDialogKeys, useDialogLifecycle } from './Modal';

export type MediaLoader = (
  item: ViewableMedia,
  onProgress: (doneBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
) => Promise<Uint8Array>;

type Shown =
  | { state: 'loading'; done: number; total: number }
  | { state: 'ready'; url: string }
  | { state: 'failed'; message: string };

const SWIPE_PIXELS = 50;

const VIEWER_BUTTON =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-30';

export function MediaViewer({
  items,
  startIndex,
  load,
  explain,
  onDownload,
  onClose,
}: {
  items: readonly ViewableMedia[];
  startIndex: number;
  load: MediaLoader;
  explain: (error: unknown) => string;
  onDownload?: (item: ViewableMedia) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const swipeFrom = useRef<number>(undefined);
  const [index, setIndex] = useState(startIndex);
  const [shown, setShown] = useState<Shown>({ state: 'loading', done: 0, total: 0 });
  const item = items[index];

  useDialogLifecycle(dialog);

  useEffect(() => {
    if (item === undefined) {
      return;
    }

    const aborted = new AbortController();
    let url: string | undefined;
    setShown({ state: 'loading', done: 0, total: 0 });

    void load(item, (done, total) => setShown({ state: 'loading', done, total }), aborted.signal)
      .then((bytes) => {
        const blob = new Blob([bytes as BlobPart], { type: item.mime });
        zeroBytes(bytes);
        if (aborted.signal.aborted) {
          return;
        }
        url = URL.createObjectURL(blob);
        setShown({ state: 'ready', url });
      })
      .catch((error: unknown) => {
        if (aborted.signal.aborted) {
          return;
        }
        setShown({
          state: 'failed',
          message: error instanceof DownloadBufferExceededError ? VIEWER_COPY.tooLarge : explain(error),
        });
      });

    return () => {
      aborted.abort();
      if (url !== undefined) {
        URL.revokeObjectURL(url);
      }
    };
  }, [item, load, explain]);

  if (item === undefined) {
    return null;
  }

  const step = (direction: 'previous' | 'next') => setIndex((current) => stepMedia(current, items.length, direction));

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const action = viewerKeyAction(event.key);
    const inVideo = event.target instanceof HTMLVideoElement;

    if ((action === 'previous' || action === 'next') && !inVideo) {
      event.preventDefault();
      step(action);
      return;
    }
    trapDialogKeys(event, dialog.current, onClose);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const from = swipeFrom.current;
    swipeFrom.current = undefined;
    if (from === undefined || event.pointerType === 'mouse') {
      return;
    }
    const travelled = event.clientX - from;
    if (Math.abs(travelled) >= SWIPE_PIXELS) {
      step(travelled < 0 ? 'next' : 'previous');
    }
  }

  const position = mediaPosition(index, items.length);
  const cannotShow = () => setShown({ state: 'failed', message: VIEWER_COPY.cannotShow });

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-ink/90 text-white outline-none backdrop-blur-sm motion-safe:animate-fade-in"
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2 sm:px-5 sm:py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-title text-white">{item.name}</p>
          {position !== '' ? <p className="text-caption normal-case tracking-normal text-white/60">{position}</p> : null}
        </div>
        {onDownload !== undefined ? (
          <button
            type="button"
            aria-label={`${VIEWER_COPY.download} ${item.name}`}
            title={VIEWER_COPY.download}
            onClick={() => onDownload(item)}
            className={VIEWER_BUTTON}
          >
            <DownloadIcon className="h-5 w-5 shrink-0" />
          </button>
        ) : null}
        <button type="button" aria-label={VIEWER_COPY.close} title={VIEWER_COPY.close} onClick={onClose} className={VIEWER_BUTTON}>
          <CloseIcon className="h-5 w-5 shrink-0" />
        </button>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16 sm:pb-8"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        onPointerDown={(event) => {
          swipeFrom.current = event.clientX;
        }}
        onPointerUp={onPointerUp}
      >
        {shown.state === 'loading' ? (
          <Centered>
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            <span className="text-compact text-white/70">{loadingLabel(shown.done, shown.total)}</span>
          </Centered>
        ) : shown.state === 'failed' ? (
          <Centered>
            <p className="max-w-sm text-center text-compact text-white/80">{shown.message}</p>
            {onDownload !== undefined ? (
              <button
                type="button"
                onClick={() => onDownload(item)}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-compact font-semibold text-ink transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <DownloadIcon className="h-4 w-4 shrink-0" />
                {VIEWER_COPY.download}
              </button>
            ) : null}
          </Centered>
        ) : item.kind === 'image' ? (
          <img
            key={shown.url}
            src={shown.url}
            alt={item.name}
            draggable={false}
            onError={cannotShow}
            className="max-h-full max-w-full select-none object-contain shadow-lift"
          />
        ) : (
          <video
            key={shown.url}
            src={shown.url}
            controls
            autoPlay
            playsInline
            onError={cannotShow}
            className="max-h-full max-w-full bg-ink shadow-lift"
          />
        )}

        {items.length > 1 ? (
          <>
            <button
              type="button"
              aria-label={VIEWER_COPY.previous}
              title={VIEWER_COPY.previous}
              disabled={index === 0}
              onClick={() => step('previous')}
              className={`${VIEWER_BUTTON} absolute left-2 top-1/2 -translate-y-1/2 bg-ink/40 sm:left-4`}
            >
              <ArrowLeftIcon className="h-5 w-5 shrink-0" />
            </button>
            <button
              type="button"
              aria-label={VIEWER_COPY.next}
              title={VIEWER_COPY.next}
              disabled={index === items.length - 1}
              onClick={() => step('next')}
              className={`${VIEWER_BUTTON} absolute right-2 top-1/2 -translate-y-1/2 bg-ink/40 sm:right-4`}
            >
              <ArrowLeftIcon className="h-5 w-5 shrink-0 rotate-180" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-3">{children}</div>;
}
