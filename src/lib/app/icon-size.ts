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

export const ICON_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'] as const;

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
  labelClass: string;
}

export const LABEL_CLASSES = {
  tiny: 'text-[11px] leading-[14px]',
  small: 'text-xs leading-4',
  regular: 'text-compact',
} as const;

const SCALES: Record<IconSize, IconScale> = {
  tiny: {
    name: 'tiny',
    label: 'Extra small',
    glyphPixels: 32,
    tilePixels: 80,
    pagePixels: 104,
    labelClass: LABEL_CLASSES.tiny,
  },
  small: {
    name: 'small',
    label: 'Small',
    glyphPixels: 48,
    tilePixels: 96,
    pagePixels: 136,
    labelClass: LABEL_CLASSES.small,
  },
  medium: {
    name: 'medium',
    label: 'Medium',
    glyphPixels: 64,
    tilePixels: 128,
    pagePixels: 160,
    labelClass: LABEL_CLASSES.regular,
  },
  large: {
    name: 'large',
    label: 'Large',
    glyphPixels: 96,
    tilePixels: 176,
    pagePixels: 200,
    labelClass: LABEL_CLASSES.regular,
  },
  huge: {
    name: 'huge',
    label: 'Extra large',
    glyphPixels: 128,
    tilePixels: 224,
    pagePixels: 264,
    labelClass: LABEL_CLASSES.regular,
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

export type PageGrid = Exclude<IconGrid, 'drive'>;

export function pagePixels(grid: PageGrid, size: IconSize): number {
  return grid === 'documents' ? iconScale(size).glyphPixels : iconScale(size).pagePixels;
}

export function gridTemplate(grid: IconGrid, size: IconSize): string {
  if (grid === 'notes') {
    return `repeat(auto-fill, ${pagePixels(grid, size)}px)`;
  }
  const column = iconScale(size).tilePixels;

  return `repeat(auto-fill, minmax(${column}px, 1fr))`;
}

export const NOTE_MINIATURE_TEXT_SHARE = 0.045;
export const DOCUMENT_MINIATURE_TEXT_SHARE = 0.04;
export const DOCUMENT_MINIATURE_TITLE_SHARE = 0.05;

export const MINIATURE_TEXT_FLOOR_PIXELS = 6;

export function miniatureTextPixels(grid: PageGrid, size: IconSize, share: number): number {
  return Math.max(MINIATURE_TEXT_FLOOR_PIXELS, Math.round(pagePixels(grid, size) * share));
}

export function documentMiniatureTitlePixels(size: IconSize): number {
  return Math.max(
    miniatureTextPixels('documents', size, DOCUMENT_MINIATURE_TITLE_SHARE),
    miniatureTextPixels('documents', size, DOCUMENT_MINIATURE_TEXT_SHARE) + 1,
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

export const ITEM_LAYOUTS = ['grid', 'list'] as const;

export type ItemLayout = (typeof ITEM_LAYOUTS)[number];

export type LayoutScreen = Exclude<IconGrid, 'notes'>;

const LAYOUT_STORAGE_KEYS: Record<LayoutScreen, string> = {
  drive: 'cryple_drive_layout',
  documents: 'cryple_documents_layout',
};

export const DEFAULT_ITEM_LAYOUT: ItemLayout = 'grid';

function isItemLayout(value: string | null): value is ItemLayout {
  return value !== null && (ITEM_LAYOUTS as readonly string[]).includes(value);
}

export function readItemLayout(screen: LayoutScreen, storage = defaultStorage()): ItemLayout {
  const raw = storage?.getItem(LAYOUT_STORAGE_KEYS[screen]) ?? null;
  return isItemLayout(raw) ? raw : DEFAULT_ITEM_LAYOUT;
}

export function writeItemLayout(
  screen: LayoutScreen,
  layout: ItemLayout,
  storage = defaultStorage(),
): void {
  storage?.setItem(LAYOUT_STORAGE_KEYS[screen], layout);
}
