import { describe, expect, it } from 'vitest';
import {
  VIEWABLE_IMAGE_TYPES,
  browserCanPlayVideo,
  loadingLabel,
  mediaKindOf,
  mediaPosition,
  stepMedia,
  viewerKeyAction,
} from './index';

const playsMp4 = (mime: string) => mime === 'video/mp4';

describe('what the viewer opens', () => {
  it('opens the image formats every current browser draws', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']) {
      expect(mediaKindOf('image', mime, playsMp4)).toBe('image');
    }
  });

  it('leaves an image the browser cannot draw to a download, rather than a broken picture', () => {
    expect(mediaKindOf('image', 'image/heic', playsMp4)).toBeUndefined();
    expect(mediaKindOf('image', 'image/tiff', playsMp4)).toBeUndefined();
    expect(VIEWABLE_IMAGE_TYPES.has('image/heic')).toBe(false);
  });

  it('plays a video only when this browser says it can', () => {
    expect(mediaKindOf('video', 'video/mp4', playsMp4)).toBe('video');
    expect(mediaKindOf('video', 'video/x-matroska', playsMp4)).toBeUndefined();
    expect(mediaKindOf('video', '', () => true)).toBeUndefined();
  });

  it('ignores the case of the type', () => {
    expect(mediaKindOf('image', 'IMAGE/PNG', playsMp4)).toBe('image');
  });

  it('never opens something that is not an image or a video, whatever its type says', () => {
    expect(mediaKindOf('pdf', 'image/png', playsMp4)).toBeUndefined();
    expect(mediaKindOf('other', 'video/mp4', playsMp4)).toBeUndefined();
  });

  it('answers no on the server, where there is no video element to ask', () => {
    expect(browserCanPlayVideo('video/mp4')).toBe(false);
  });
});

describe('moving through the media', () => {
  it('maps the keys a photo viewer uses', () => {
    expect(viewerKeyAction('Escape')).toBe('close');
    expect(viewerKeyAction('ArrowLeft')).toBe('previous');
    expect(viewerKeyAction('ArrowRight')).toBe('next');
    expect(viewerKeyAction(' ')).toBeUndefined();
  });

  it('stops at the ends rather than wrapping around', () => {
    expect(stepMedia(0, 3, 'next')).toBe(1);
    expect(stepMedia(2, 3, 'next')).toBe(2);
    expect(stepMedia(0, 3, 'previous')).toBe(0);
    expect(stepMedia(0, 1, 'next')).toBe(0);
  });

  it('says where you are only when there is more than one', () => {
    expect(mediaPosition(1, 4)).toBe('2 of 4');
    expect(mediaPosition(0, 1)).toBe('');
  });
});

describe('while a file is decrypted', () => {
  it('reports a whole-number percentage, never over 100', () => {
    expect(loadingLabel(0, 200)).toBe('Decrypting… 0%');
    expect(loadingLabel(101, 200)).toBe('Decrypting… 50%');
    expect(loadingLabel(300, 200)).toBe('Decrypting… 100%');
    expect(loadingLabel(0, 0)).toBe('Decrypting…');
  });
});
