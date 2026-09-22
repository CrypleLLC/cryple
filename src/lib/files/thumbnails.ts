import { zeroBytes } from '@/lib/encoding';
import { wrapper, type FilesContext } from './api';
import { readCachedObject, writeCachedObject } from './cache';
import { fetchSealedObject, openSealedObject } from './download';
import { openManifest } from './manifest';
import type { FileRecord } from './records';

export const THUMBNAIL_MAX_EDGE = 320;
export const THUMBNAIL_MIME = 'image/jpeg';
export const THUMBNAIL_QUALITY = 0.72;
export const THUMBNAIL_NAME = 'thumbnail.jpg';

const THUMBNAILABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

export function canThumbnail(mime: string): boolean {
  return THUMBNAILABLE.has(mime.toLowerCase().split(';')[0].trim());
}

export interface Extent {
  width: number;
  height: number;
}

export function thumbnailExtent(source: Extent, maxEdge = THUMBNAIL_MAX_EDGE): Extent {
  const longest = Math.max(source.width, source.height);
  if (longest <= 0) {
    return { width: 0, height: 0 };
  }
  if (longest <= maxEdge) {
    return { width: source.width, height: source.height };
  }

  const scale = maxEdge / longest;

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

interface ThumbnailCanvas {
  width: number;
  height: number;
  getContext: (kind: '2d') => { drawImage: (source: ImageBitmap, x: number, y: number, w: number, h: number) => void } | null;
  convertToBlob: (options: { type: string; quality: number }) => Promise<Blob>;
}

export async function deriveThumbnail(file: File): Promise<Blob | undefined> {
  if (!canThumbnail(file.type) || typeof createImageBitmap !== 'function') {
    return undefined;
  }

  const Canvas = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => ThumbnailCanvas })
    .OffscreenCanvas;
  if (Canvas === undefined) {
    return undefined;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const extent = thumbnailExtent(bitmap);
    if (extent.width === 0) {
      return undefined;
    }

    const canvas = new Canvas(extent.width, extent.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      return undefined;
    }

    context.drawImage(bitmap, 0, 0, extent.width, extent.height);

    return await canvas.convertToBlob({ type: THUMBNAIL_MIME, quality: THUMBNAIL_QUALITY });
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
}

export function thumbnailIdsOf(manifests: readonly { thumbnail_id?: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (manifest.thumbnail_id !== undefined) {
      ids.add(manifest.thumbnail_id);
    }
  }

  return ids;
}

export interface OpenedPreview {
  bytes: Uint8Array;
  mime: string;
  cached: boolean;
}

export async function openPreview(
  context: FilesContext,
  record: FileRecord,
): Promise<OpenedPreview> {
  const dek = await wrapper(context).unwrapDek(record);

  try {
    const manifest = await openManifest(record.ciphertext, dek);
    const held = await readCachedObject(record.id);
    const sealed = held ?? (await fetchSealedObject(context, record.id));

    const bytes = await openSealedObject(sealed, manifest, dek);

    if (held === undefined) {
      await writeCachedObject(record.id, sealed);
    }

    return { bytes, mime: manifest.mime, cached: held !== undefined };
  } finally {
    zeroBytes(dek);
  }
}
