import { describe, expect, it } from 'vitest';
import type { PreferenceStorage as VaultStorage } from './icon-size';
import {
  DOCUMENT_MINIATURE_TEXT_SHARE,
  DOCUMENT_MINIATURE_TITLE_SHARE,
  ICON_SIZES,
  MINIATURE_TEXT_FLOOR_PIXELS,
  NOTE_MINIATURE_TEXT_SHARE,
  defaultIconSize,
  gridTemplate,
  iconScale,
  isLargestIconSize,
  isSmallestIconSize,
  largerIconSize,
  miniatureTextPixels,
  readIconSize,
  smallerIconSize,
  writeIconSize,
  type IconGrid,
} from './index';

const GRIDS: readonly IconGrid[] = ['drive', 'notes', 'documents'];

function memoryStorage(): VaultStorage {
  const held = new Map<string, string>();

  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
    removeItem: (key) => {
      held.delete(key);
    },
  };
}

describe('the icon scale', () => {
  it('grows strictly from one step to the next, in all three geometries', () => {
    const ascending = (values: number[]) =>
      values.every((value, index) => index === 0 || value > values[index - 1]);

    expect(ascending(ICON_SIZES.map((size) => iconScale(size).glyphPixels))).toBe(true);
    expect(ascending(ICON_SIZES.map((size) => iconScale(size).tilePixels))).toBe(true);
    expect(ascending(ICON_SIZES.map((size) => iconScale(size).pagePixels))).toBe(true);
  });

  it('leaves a drive tile wider than the glyph it holds, so the name has room', () => {
    for (const size of ICON_SIZES) {
      const scale = iconScale(size);
      expect(scale.tilePixels).toBeGreaterThan(scale.glyphPixels);
    }
  });

  it('stops labelling the glyph where the label would be too small to read', () => {
    expect(iconScale('small').labelsTheGlyph).toBe(false);
    expect(iconScale('medium').labelsTheGlyph).toBe(true);
  });
});

describe('stepping through the sizes', () => {
  it('walks up and back down the whole scale', () => {
    expect(largerIconSize('small')).toBe('medium');
    expect(largerIconSize('medium')).toBe('large');
    expect(largerIconSize('large')).toBe('huge');
    expect(smallerIconSize('huge')).toBe('large');
    expect(smallerIconSize('medium')).toBe('small');
  });

  it('holds at the ends rather than wrapping around', () => {
    expect(largerIconSize('huge')).toBe('huge');
    expect(smallerIconSize('small')).toBe('small');
    expect(isLargestIconSize('huge')).toBe(true);
    expect(isSmallestIconSize('small')).toBe(true);
    expect(isLargestIconSize('large')).toBe(false);
    expect(isSmallestIconSize('medium')).toBe(false);
  });
});

describe('the grid each screen draws', () => {
  it('fills the row with whatever fits, rather than a fixed column count', () => {
    expect(gridTemplate('drive', 'large')).toBe(
      `repeat(auto-fill, minmax(${iconScale('large').tilePixels}px, 1fr))`,
    );
  });

  it('sizes a page grid by the page, not by the drive tile', () => {
    expect(gridTemplate('notes', 'large')).toBe(
      `repeat(auto-fill, minmax(${iconScale('large').pagePixels}px, 1fr))`,
    );
    expect(gridTemplate('documents', 'small')).toBe(gridTemplate('notes', 'small'));
    expect(gridTemplate('drive', 'small')).not.toBe(gridTemplate('notes', 'small'));
  });
});

describe('text inside a page miniature', () => {
  it('is a share of the page, so the miniature stays a scale drawing at every step', () => {
    expect(miniatureTextPixels('large', NOTE_MINIATURE_TEXT_SHARE)).toBe(9);
    expect(miniatureTextPixels('large', DOCUMENT_MINIATURE_TEXT_SHARE)).toBe(8);
    expect(miniatureTextPixels('large', DOCUMENT_MINIATURE_TITLE_SHARE)).toBe(10);

    expect(miniatureTextPixels('huge', NOTE_MINIATURE_TEXT_SHARE)).toBeGreaterThan(
      miniatureTextPixels('medium', NOTE_MINIATURE_TEXT_SHARE),
    );
  });

  it('never rounds away to nothing at the smallest step', () => {
    expect(miniatureTextPixels('small', 0.001)).toBe(MINIATURE_TEXT_FLOOR_PIXELS);
  });

  it('keeps a document title larger than its body even where the floor bites', () => {
    for (const size of ICON_SIZES) {
      expect(miniatureTextPixels(size, DOCUMENT_MINIATURE_TITLE_SHARE)).toBeGreaterThan(
        miniatureTextPixels(size, DOCUMENT_MINIATURE_TEXT_SHARE),
      );
    }
  });
});

describe('remembering the chosen size', () => {
  it('reads back what was written, per screen', () => {
    const storage = memoryStorage();
    writeIconSize('drive', 'huge', storage);

    expect(readIconSize('drive', storage)).toBe('huge');
    expect(readIconSize('notes', storage)).toBe(defaultIconSize('notes'));
  });

  it('keeps the three screens on separate keys, because they hold different shapes', () => {
    const storage = memoryStorage();
    for (const grid of GRIDS) {
      writeIconSize(grid, 'small', storage);
    }

    writeIconSize('drive', 'huge', storage);

    expect(readIconSize('drive', storage)).toBe('huge');
    expect(readIconSize('notes', storage)).toBe('small');
    expect(readIconSize('documents', storage)).toBe('small');
  });

  it('opens a page grid larger than an icon grid by default', () => {
    expect(defaultIconSize('drive')).toBe('medium');
    expect(defaultIconSize('notes')).toBe('large');
    expect(defaultIconSize('documents')).toBe('large');
  });

  it('falls back to the default when nothing is stored', () => {
    const storage = memoryStorage();
    for (const grid of GRIDS) {
      expect(readIconSize(grid, storage)).toBe(defaultIconSize(grid));
    }
  });

  it('treats an unrecognised value as no preference at all', () => {
    const storage = memoryStorage();
    storage.setItem('cryple_drive_icon_size', 'gigantic');

    expect(readIconSize('drive', storage)).toBe(defaultIconSize('drive'));
  });

  it('is a no-op without storage, so server rendering does not throw', () => {
    expect(() => writeIconSize('notes', 'small', undefined)).not.toThrow();
    expect(readIconSize('notes', undefined)).toBe(defaultIconSize('notes'));
  });
});
