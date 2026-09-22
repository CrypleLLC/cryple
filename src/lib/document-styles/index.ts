export interface StyleOption {
  label: string;
  value: string;
}

export const FONT_FAMILIES: readonly StyleOption[] = [
  { label: 'Sans', value: 'var(--font-sans)' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'var(--font-mono)' },
];

export const FONT_SIZES: readonly string[] = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];
export const DEFAULT_FONT_SIZE = '16px';

export const LINE_HEIGHTS: readonly StyleOption[] = [
  { label: 'Single', value: '1.3' },
  { label: 'Normal', value: '1.7' },
  { label: '1.5', value: '2' },
  { label: 'Double', value: '2.6' },
];
export const DEFAULT_LINE_HEIGHT = '1.7';

export const HIGHLIGHT_COLORS: readonly string[] = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca'];
export const TEXT_COLORS: readonly string[] = ['#0f172a', '#b91c1c', '#1d4ed8', '#15803d', '#a16207'];

const MAX_STYLE_VALUE_LENGTH = 64;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLOR = /^[a-z]{3,20}$/i;
const CSS_NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:%|deg)?`;
const FUNCTIONAL_COLOR = new RegExp(
  String.raw`^(?:rgba?|hsla?)\(\s*${CSS_NUMBER}(?:(?:\s*[,/]\s*|\s+)${CSS_NUMBER}){2,3}\s*\)$`,
  'i',
);

export function styleDeclaration(style: string | null, property: string): string | undefined {
  if (style === null) {
    return undefined;
  }

  const wanted = property.toLowerCase();
  const declarations = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0);

  for (let index = declarations.length - 1; index >= 0; index -= 1) {
    const declaration = declarations[index];
    const colon = declaration.indexOf(':');
    if (colon !== -1 && declaration.slice(0, colon).trim().toLowerCase() === wanted) {
      return declaration.slice(colon + 1).trim();
    }
  }

  return undefined;
}

function candidate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > MAX_STYLE_VALUE_LENGTH ? undefined : trimmed;
}

export function safeColor(value: unknown): string | undefined {
  const color = candidate(value);
  if (color === undefined) {
    return undefined;
  }
  return HEX_COLOR.test(color) || FUNCTIONAL_COLOR.test(color) || NAMED_COLOR.test(color)
    ? color
    : undefined;
}

function comparableFamily(value: string): string {
  return value.replace(/["'\s]/g, '').toLowerCase();
}

export function safeFontFamily(value: unknown): string | undefined {
  const family = candidate(value);
  if (family === undefined) {
    return undefined;
  }
  const wanted = comparableFamily(family);
  return FONT_FAMILIES.find((option) => comparableFamily(option.value) === wanted)?.value;
}

export function safeFontSize(value: unknown): string | undefined {
  const size = candidate(value);
  return size !== undefined && FONT_SIZES.includes(size) ? size : undefined;
}

export function safeLineHeight(value: unknown): string | undefined {
  const height = candidate(value);
  return LINE_HEIGHTS.find((option) => option.value === height)?.value;
}

export type StyleSanitizer = (value: unknown) => string | undefined;

export interface StyledElement {
  getAttribute(name: string): string | null;
}

export interface StyleAttributeSpec {
  default: null;
  parseHTML: (element: StyledElement) => string | null;
  renderHTML: (attributes: Record<string, unknown>) => Record<string, string>;
}

export function styleAttribute(
  name: string,
  property: string,
  sanitize: StyleSanitizer,
): StyleAttributeSpec {
  return {
    default: null,
    parseHTML: (element) =>
      sanitize(styleDeclaration(element.getAttribute('style'), property)) ?? null,
    renderHTML: (attributes): Record<string, string> => {
      const value = sanitize(attributes[name]);
      return value === undefined ? {} : { style: `${property}: ${value}` };
    },
  };
}

export function highlightColorAttribute(): StyleAttributeSpec {
  return {
    default: null,
    parseHTML: (element) =>
      safeColor(element.getAttribute('data-color')) ??
      safeColor(styleDeclaration(element.getAttribute('style'), 'background-color')) ??
      null,
    renderHTML: (attributes): Record<string, string> => {
      const color = safeColor(attributes.color);
      return color === undefined
        ? {}
        : { 'data-color': color, style: `background-color: ${color}; color: inherit` };
    },
  };
}
