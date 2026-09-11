import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetPreviews,
  hasPreview,
  previewUrls,
  setPreview,
  subscribeToPreviews,
} from './previews';

beforeEach(() => {
  vi.stubGlobal('URL', { revokeObjectURL: vi.fn() });
});

afterEach(() => {
  forgetPreviews();
  vi.unstubAllGlobals();
});

describe('the previews a grid has already decrypted', () => {
  it('keeps the first url it was given, because a second decrypt is waste', () => {
    setPreview('a', 'blob:one');
    setPreview('a', 'blob:two');

    expect(previewUrls().get('a')).toBe('blob:one');
  });

  it('answers whether one is known without handing out the map', () => {
    expect(hasPreview('a')).toBe(false);
    setPreview('a', 'blob:one');
    expect(hasPreview('a')).toBe(true);
  });

  it('keeps the same map until something new arrives', () => {
    setPreview('a', 'blob:one');
    const first = previewUrls();

    setPreview('a', 'blob:again');
    expect(previewUrls()).toBe(first);

    setPreview('b', 'blob:two');
    expect(previewUrls()).not.toBe(first);
  });

  it('wakes subscribers only for a preview it did not have', () => {
    const listener = vi.fn();
    subscribeToPreviews(listener);

    setPreview('a', 'blob:one');
    setPreview('a', 'blob:one');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('revokes every url when the session lets them go', () => {
    setPreview('a', 'blob:one');
    setPreview('b', 'blob:two');

    forgetPreviews();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:two');
    expect(previewUrls().size).toBe(0);
  });
});
