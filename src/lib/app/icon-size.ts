export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type IconGrid = 'drive' | 'notes' | 'documents';

const STORAGE_KEYS: Record<IconGrid, string> = {
  drive: 'cryple_drive_icon_size',
  notes: 'cryple_notes_icon_size',
  documents: 'cryple_documents_icon_size',
};

export const ICON_SIZES = ['small', 'medium', 'large', 'huge'] as const;

export type IconSize = (typeof ICON_SIZES)[number];

const DEFAULTS: Record<IconGrid, IconSize> = {
  drive: 'medium',
  notes: 'large',
  documents: 'large',
};

export interface IconScale {
  name: IconSize;
  label: string;
  glyphPixels: number;
  tilePixels: number;
  pagePixels: number;
  labelsTheGlyph: boolean;
}

const SCALES: Record<IconSize, IconScale> = {
  small: {
    name: 'small',
    label: 'Small',
    glyphPixels: 48,
    tilePixels: 96,
    pagePixels: 136,
    labelsTheGlyph: false,
  },
  medium: {
    name: 'medium',
    label: 'Medium',
    glyphPixels: 64,
    tilePixels: 128,
    pagePixels: 160,
    labelsTheGlyph: true,
  },
  large: {
    name: 'large',
    label: 'Large',
    glyphPixels: 96,
    tilePixels: 176,
    pagePixels: 200,
    labelsTheGlyph: true,
  },
  huge: {
    name: 'huge',
    label: 'Extra large',
    glyphPixels: 128,
    tilePixels: 224,
    pagePixels: 264,
    labelsTheGlyph: true,
  },
};

export function iconScale(size: IconSize): IconScale {
  return SCALES[size];
}

export function defaultIconSize(grid: IconGrid): IconSize {
  return DEFAULTS[grid];
}

export function largerIconSize(size: IconSize): IconSize {
  const next = ICON_SIZES.indexOf(size) + 1;
  return next < ICON_SIZES.length ? ICON_SIZES[next] : size;
}

export function smallerIconSize(size: IconSize): IconSize {
  const previous = ICON_SIZES.indexOf(size) - 1;
  return previous >= 0 ? ICON_SIZES[previous] : size;
}

export function isLargestIconSize(size: IconSize): boolean {
  return size === ICON_SIZES[ICON_SIZES.length - 1];
}

export function isSmallestIconSize(size: IconSize): boolean {
  return size === ICON_SIZES[0];
}

export function gridTemplate(grid: IconGrid, size: IconSize): string {
  const scale = iconScale(size);
  const column = grid === 'drive' ? scale.tilePixels : scale.pagePixels;

  return `repeat(auto-fill, minmax(${column}px, 1fr))`;
}

export const NOTE_MINIATURE_TEXT_SHARE = 0.045;
export const DOCUMENT_MINIATURE_TEXT_SHARE = 0.04;
export const DOCUMENT_MINIATURE_TITLE_SHARE = 0.05;

export const MINIATURE_TEXT_FLOOR_PIXELS = 6;

export function miniatureTextPixels(size: IconSize, share: number): number {
  return Math.max(
    MINIATURE_TEXT_FLOOR_PIXELS,
    Math.round(iconScale(size).pagePixels * share),
  );
}

function defaultStorage(): PreferenceStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function isIconSize(value: string | null): value is IconSize {
  return value !== null && (ICON_SIZES as readonly string[]).includes(value);
}

export function readIconSize(grid: IconGrid, storage = defaultStorage()): IconSize {
  const raw = storage?.getItem(STORAGE_KEYS[grid]) ?? null;
  return isIconSize(raw) ? raw : defaultIconSize(grid);
}

export function writeIconSize(
  grid: IconGrid,
  size: IconSize,
  storage = defaultStorage(),
): void {
  storage?.setItem(STORAGE_KEYS[grid], size);
}
