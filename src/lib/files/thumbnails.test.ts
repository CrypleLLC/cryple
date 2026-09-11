import { describe, expect, it } from 'vitest';
import {
  THUMBNAIL_MAX_EDGE,
  canThumbnail,
  deriveThumbnail,
  thumbnailExtent,
  thumbnailIdsOf,
} from './thumbnails';

describe('what can have a thumbnail', () => {
  it('covers the image types a browser can actually decode', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']) {
      expect(canThumbnail(mime)).toBe(true);
    }
  });

  it('ignores case and parameters, because a File carries what the OS said', () => {
    expect(canThumbnail('IMAGE/JPEG')).toBe(true);
    expect(canThumbnail('image/jpeg; charset=binary')).toBe(true);
  });

  it('leaves out what a browser cannot decode or should not run', () => {
    for (const mime of ['image/heic', 'image/svg+xml', 'video/mp4', 'application/pdf', '']) {
      expect(canThumbnail(mime)).toBe(false);
    }
  });
});

describe('the extent a thumbnail is drawn at', () => {
  it('fits the longest edge and keeps the aspect ratio', () => {
    expect(thumbnailExtent({ width: 4000, height: 3000 })).toEqual({ width: 320, height: 240 });
    expect(thumbnailExtent({ width: 3000, height: 4000 })).toEqual({ width: 240, height: 320 });
  });

  it('never enlarges an image that is already small', () => {
    expect(thumbnailExtent({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
  });

  it('keeps a sliver of a very wide image rather than rounding it away', () => {
    expect(thumbnailExtent({ width: 10_000, height: 5 })).toEqual({ width: 320, height: 1 });
  });

  it('answers zero for a zero-sized source instead of dividing by it', () => {
    expect(thumbnailExtent({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });

  it('uses the same maximum edge the module publishes', () => {
    const extent = thumbnailExtent({ width: 5000, height: 5000 });

    expect(Math.max(extent.width, extent.height)).toBe(THUMBNAIL_MAX_EDGE);
  });
});

describe('deriving one', () => {
  it('gives up quietly where the canvas APIs are missing, because it is optional', async () => {
    const file = new File([new Uint8Array(8)], 'photo.jpg', { type: 'image/jpeg' });

    await expect(deriveThumbnail(file)).resolves.toBeUndefined();
  });

  it('does not even try for a type it cannot decode', async () => {
    const file = new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' });

    await expect(deriveThumbnail(file)).resolves.toBeUndefined();
  });
});

describe('telling thumbnails apart from files', () => {
  it('collects the ids the parents point at', () => {
    const ids = thumbnailIdsOf([{ thumbnail_id: 'a' }, {}, { thumbnail_id: 'b' }]);

    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('is empty when nothing has one, so nothing is hidden by accident', () => {
    expect(thumbnailIdsOf([{}, {}]).size).toBe(0);
  });
});
