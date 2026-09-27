import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const EXPECTED_FONT_SHA256 = '5590990c82e097397517f275f430af4546e1c45cff408bde4255dad142479dcb';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const OUTPUT = fileURLToPath(new URL('../src/lib/recovery-kit/glyphs.ts', import.meta.url));

const fontPath = process.argv[2];
if (fontPath === undefined) {
  throw new Error('usage: node tools/recovery-kit-glyphs.mjs <path to JetBrainsMono-Bold.ttf>');
}

const bytes = readFileSync(fontPath);
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== EXPECTED_FONT_SHA256) {
  throw new Error(`unexpected font: sha256 ${digest}, expected ${EXPECTED_FONT_SHA256}`);
}

const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const advances = new Set();
const paths = [];

for (const letter of LETTERS) {
  const glyph = font.charToGlyph(letter);
  advances.add(glyph.advanceWidth);
  const data = glyph
    .getPath(0, 0, font.unitsPerEm)
    .toPathData({ decimalPlaces: 0, flipY: false });
  paths.push(`  ${letter}: '${data}',`);
}

if (advances.size !== 1) {
  throw new Error('the font is not monospaced across a-z');
}

writeFileSync(
  OUTPUT,
  [
    `export const GLYPH_UNITS_PER_EM = ${font.unitsPerEm};`,
    '',
    `export const GLYPH_ADVANCE = ${[...advances][0]};`,
    '',
    'export const GLYPH_PATHS: Readonly<Record<string, string>> = {',
    ...paths,
    '};',
    '',
  ].join('\n'),
);
