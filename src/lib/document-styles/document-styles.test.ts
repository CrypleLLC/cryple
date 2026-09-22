import { describe, expect, it } from 'vitest';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  LINE_HEIGHTS,
  TEXT_COLORS,
  highlightColorAttribute,
  safeColor,
  safeFontFamily,
  safeFontSize,
  safeLineHeight,
  styleAttribute,
  styleDeclaration,
  type StyledElement,
} from './index';

const TRACKER = 'https://tracker.example/opened';

function pasted(attributes: Record<string, string>): StyledElement {
  return { getAttribute: (name) => attributes[name] ?? null };
}

const INJECTIONS = [
  `red; background-image: url(${TRACKER})`,
  `url(${TRACKER})`,
  `red url(${TRACKER})`,
  'var(--anything)',
  'expression(alert(1))',
  'rgb(1, 2, 3); background: red',
  String.raw`\75rl(x)`,
  '"red"; x: y',
  'red /* comment */',
  '',
  'x'.repeat(65),
];

describe('styleDeclaration', () => {
  it('reads one declaration, and the last one when repeated', () => {
    expect(styleDeclaration('color: red; COLOR : blue', 'color')).toBe('blue');
    expect(styleDeclaration('font-size: 16px; background-image: url(x)', 'font-size')).toBe('16px');
  });

  it('finds nothing in an absent or unrelated style', () => {
    expect(styleDeclaration(null, 'color')).toBeUndefined();
    expect(styleDeclaration('font-size: 16px', 'color')).toBeUndefined();
    expect(styleDeclaration('color', 'color')).toBeUndefined();
  });
});

describe('safeColor', () => {
  it('accepts the colour forms a paste or the toolbar produces', () => {
    for (const color of ['#fef08a', '#FFF', '#0f172a80', 'rgb(1, 2, 3)', 'rgba(1 2 3 / 50%)', 'hsl(120deg 50% 50%)', 'red']) {
      expect(safeColor(color)).toBe(color);
    }
  });

  it('refuses anything that could carry a second declaration or load a resource', () => {
    for (const injection of INJECTIONS) {
      expect(safeColor(injection)).toBeUndefined();
    }
    expect(safeColor(42)).toBeUndefined();
    expect(safeColor(null)).toBeUndefined();
  });
});

describe('the list-bound values', () => {
  it('maps a font family written with other quotes or spacing to the toolbar value', () => {
    expect(safeFontFamily(`Georgia,'Times New Roman',serif`)).toBe('Georgia, "Times New Roman", serif');
    expect(safeFontFamily('var(--font-mono)')).toBe('var(--font-mono)');
  });

  it('drops any family, size or line height the toolbar cannot produce', () => {
    expect(safeFontFamily('Comic Sans MS')).toBeUndefined();
    expect(safeFontSize('11pt')).toBeUndefined();
    expect(safeLineHeight('1.15')).toBeUndefined();
    for (const injection of INJECTIONS) {
      expect(safeFontFamily(injection)).toBeUndefined();
      expect(safeFontSize(injection)).toBeUndefined();
      expect(safeLineHeight(injection)).toBeUndefined();
    }
  });

  it('accepts every value the toolbar offers', () => {
    for (const option of FONT_FAMILIES) {
      expect(safeFontFamily(option.value)).toBe(option.value);
    }
    for (const size of FONT_SIZES) {
      expect(safeFontSize(size)).toBe(size);
    }
    for (const option of LINE_HEIGHTS) {
      expect(safeLineHeight(option.value)).toBe(option.value);
    }
    for (const color of [...HIGHLIGHT_COLORS, ...TEXT_COLORS]) {
      expect(safeColor(color)).toBe(color);
    }
  });
});

describe('styleAttribute', () => {
  const fontSize = styleAttribute('fontSize', 'font-size', safeFontSize);

  it('keeps only its own declaration from a pasted style', () => {
    expect(fontSize.parseHTML(pasted({ style: `font-size: 16px; background-image: url(${TRACKER})` }))).toBe('16px');
    expect(fontSize.renderHTML({ fontSize: '16px' })).toEqual({ style: 'font-size: 16px' });
  });

  it('stores nothing for a value it refuses', () => {
    expect(fontSize.parseHTML(pasted({ style: 'font-size: 11pt' }))).toBeNull();
  });

  it('renders nothing for a refused value already in the document', () => {
    expect(fontSize.renderHTML({ fontSize: `16px; background-image: url(${TRACKER})` })).toEqual({});
  });
});

describe('highlightColorAttribute', () => {
  const highlight = highlightColorAttribute();

  it('refuses an injected data-color and falls back to the style', () => {
    const element = pasted({
      'data-color': `red; background-image: url(${TRACKER})`,
      style: 'background-color: #fef08a',
    });
    expect(highlight.parseHTML(element)).toBe('#fef08a');
  });

  it('stores nothing when neither source is a colour', () => {
    expect(highlight.parseHTML(pasted({ 'data-color': `url(${TRACKER})` }))).toBeNull();
  });

  it('renders a valid colour the way TipTap does, and nothing for an injected one', () => {
    expect(highlight.renderHTML({ color: '#bbf7d0' })).toEqual({
      'data-color': '#bbf7d0',
      style: 'background-color: #bbf7d0; color: inherit',
    });
    expect(highlight.renderHTML({ color: `red; background-image: url(${TRACKER})` })).toEqual({});
  });
});
