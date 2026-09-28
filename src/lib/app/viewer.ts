import type { FileKind } from './files';

export type MediaKind = 'image' | 'video';

export interface ViewableMedia {
  id: string;
  name: string;
  mime: string;
  kind: MediaKind;
}

export const VIEWABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export type CanPlayVideo = (mime: string) => boolean;

export function mediaKindOf(kind: FileKind, mime: string, canPlayVideo: CanPlayVideo): MediaKind | undefined {
  const type = mime.toLowerCase();
  if (kind === 'image' && VIEWABLE_IMAGE_TYPES.has(type)) {
    return 'image';
  }
  if (kind === 'video' && type !== '' && canPlayVideo(type)) {
    return 'video';
  }
  return undefined;
}

export function browserCanPlayVideo(mime: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.createElement('video').canPlayType(mime) !== '';
}

export type ViewerKeyAction = 'close' | 'previous' | 'next';

export function viewerKeyAction(key: string): ViewerKeyAction | undefined {
  switch (key) {
    case 'Escape':
      return 'close';
    case 'ArrowLeft':
      return 'previous';
    case 'ArrowRight':
      return 'next';
    default:
      return undefined;
  }
}

export function stepMedia(index: number, count: number, direction: 'previous' | 'next'): number {
  const next = direction === 'next' ? index + 1 : index - 1;
  return Math.min(Math.max(next, 0), Math.max(count - 1, 0));
}

export function mediaPosition(index: number, count: number): string {
  return count > 1 ? `${index + 1} of ${count}` : '';
}

export function loadingLabel(doneBytes: number, totalBytes: number): string {
  if (totalBytes <= 0) {
    return 'Decrypting…';
  }
  return `Decrypting… ${Math.min(100, Math.floor((doneBytes / totalBytes) * 100))}%`;
}

export const VIEWER_COPY = {
  tooLarge:
    'This file is too large to open in the browser. Download it to view it on this device.',
  cannotShow: 'This browser cannot show this file. Download it to open it with another app.',
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
  download: 'Download',
} as const;
