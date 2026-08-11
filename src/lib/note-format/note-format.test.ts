import { describe, expect, it } from 'vitest';
import {
  blockPlainText,
  blocksToHtml,
  blockToHtml,
  canGrowNoteFont,
  canShrinkNoteFont,
  changeNoteFontSize,
  snapNoteFontSize,
  cycleBlockType,
  escapeHtml,
  formatBlocks,
  formatInline,
  mergeSpans,
  parseBlocks,
  parseInline,
  toDisplayText,
  toHtml,
  toPlainText,
  NOTE_FONT_DEFAULT_PX,
  NOTE_FONT_MAX_PX,
  NOTE_FONT_MIN_PX,
  NOTE_FONT_SIZES,
  type InlineSpan,
  type NoteBlock,
} from './index';

const plain = (text: string): InlineSpan => ({ text, bold: false, italic: false });

describe('parseBlocks', () => {
  it('reads every line type back from its marker', () => {
    const blocks = parseBlocks('# Plans\n- stamps\n- [ ] pack\n- [x] flights\njust a line');

    expect(blocks.map((block) => block.type)).toEqual([
      'title',
      'topic',
      'task',
      'task',
      'text',
    ]);
    expect(blocks.map((block) => block.checked)).toEqual([false, false, false, true, false]);
    expect(blocks.map(blockPlainText)).toEqual([
      'Plans',
      'stamps',
      'pack',
      'flights',
      'just a line',
    ]);
  });

  it('checks the task markers before the topic marker they start with', () => {
    expect(parseBlocks('- [ ] x')[0].type).toBe('task');
    expect(parseBlocks('- [x] x')[0].type).toBe('task');
  });

  it('leaves a marker without its trailing space as plain text', () => {
    expect(parseBlocks('#')[0].type).toBe('text');
    expect(parseBlocks('-')[0].type).toBe('text');
  });

  it('round-trips any document through formatBlocks', () => {
    const source = '# Plans\n- stamps\n- [ ] pack\n- [x] flights\nSee **you** in *June*.\n\nBye';
    expect(formatBlocks(parseBlocks(source))).toBe(source);
  });

  it('treats a note written before formatting existed as plain text', () => {
    const legacy = 'Dear Ana,\n\nThe safe code is 4417.\nLove, P.';
    expect(parseBlocks(legacy).every((block) => block.type === 'text')).toBe(true);
    expect(formatBlocks(parseBlocks(legacy))).toBe(legacy);
    expect(toPlainText(legacy)).toBe(legacy);
  });
});

describe('parseInline', () => {
  it('splits a line into styled spans', () => {
    expect(parseInline('See **you** in *June*')).toEqual([
      plain('See '),
      { text: 'you', bold: true, italic: false },
      plain(' in '),
      { text: 'June', bold: false, italic: true },
    ]);
  });

  it('reads a bold-italic run as both', () => {
    expect(parseInline('***both***')).toEqual([{ text: 'both', bold: true, italic: true }]);
  });

  it('leaves an unpaired asterisk as ordinary text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([plain('2 * 3 = 6')]);
    expect(parseInline('a * b')).toEqual([plain('a * b')]);
    expect(parseInline('trailing *')).toEqual([plain('trailing *')]);
  });

  it('round-trips through formatInline', () => {
    for (const line of ['See **you** in *June*', '***both***', 'nothing special', '2 * 3']) {
      expect(formatInline(parseInline(line))).toBe(line);
    }
  });

  it('merges neighbouring spans of the same style instead of emitting empty pairs', () => {
    const merged = mergeSpans([
      { text: 'a', bold: true, italic: false },
      { text: 'b', bold: true, italic: false },
      { text: '', bold: false, italic: false },
      plain('c'),
    ]);

    expect(merged).toEqual([{ text: 'ab', bold: true, italic: false }, plain('c')]);
    expect(formatInline(merged)).toBe('**ab**c');
  });
});

describe('inline font size', () => {
  it('carries a size on the spans it wraps, not on the line', () => {
    expect(parseInline('small {{18}}big{{/}} small')).toEqual([
      plain('small '),
      { text: 'big', bold: false, italic: false, size: 18 },
      plain(' small'),
    ]);
  });

  it('leaves text with no size marker unsized', () => {
    expect(parseInline('plain')[0].size).toBe(undefined);
  });

  it('combines with bold and italic inside the same run', () => {
    expect(parseInline('{{16}}**bold** and *italic*{{/}}')).toEqual([
      { text: 'bold', bold: true, italic: false, size: 16 },
      { text: ' and ', bold: false, italic: false, size: 16 },
      { text: 'italic', bold: false, italic: true, size: 16 },
    ]);
  });

  it('round-trips a mixed line', () => {
    for (const line of [
      'small {{18}}big{{/}} small',
      '{{12}}**tiny bold**{{/}}',
      '{{16}}a{{/}} b {{16}}c{{/}}',
    ]) {
      expect(formatInline(parseInline(line))).toBe(line);
    }
  });

  it('emits one wrapper around a run rather than one per span', () => {
    expect(
      formatInline([
        { text: 'a', bold: true, italic: false, size: 16 },
        { text: 'b', bold: false, italic: false, size: 16 },
      ]),
    ).toBe('{{16}}**a**b{{/}}');
  });

  it('does not merge spans that differ only in size', () => {
    const merged = mergeSpans([
      { text: 'a', bold: false, italic: false, size: 16 },
      { text: 'b', bold: false, italic: false, size: 18 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('leaves an unpaired or unknown size marker as ordinary text', () => {
    expect(parseInline('{{16}}unclosed')).toEqual([plain('{{16}}unclosed')]);
    expect(parseInline('{{15}}odd size{{/}}')).toEqual([plain('{{15}}odd size{{/}}')]);
    expect(parseInline('use {{ and }} freely')).toEqual([plain('use {{ and }} freely')]);
  });

  it('keeps size out of the file name, the thumbnail and the character count', () => {
    const note = '{{18}}Big title{{/}}\n- [ ] {{12}}small task{{/}}';
    expect(toPlainText(note)).toBe('Big title\nsmall task');
    expect(toDisplayText(note)).toBe('Big title\n☐ small task');
  });

  it('renders a sized run as a real span, outside the style elements', () => {
    expect(toHtml('{{18}}**big bold**{{/}}')).toBe(
      '<div data-line="text"><span style="font-size:18px"><strong>big bold</strong></span></div>',
    );
  });
});

describe('cycleBlockType', () => {
  const block = (type: NoteBlock['type'], checked = false): NoteBlock => ({
    type,
    checked,
    spans: [plain('x')],
  });

  it('toggles title and topic off when applied to their own type', () => {
    expect(cycleBlockType(block('title'), 'title').type).toBe('text');
    expect(cycleBlockType(block('topic'), 'topic').type).toBe('text');
  });

  it('replaces one type with another rather than stacking', () => {
    expect(cycleBlockType(block('title'), 'topic').type).toBe('topic');
    expect(cycleBlockType(block('task', true), 'title')).toMatchObject({
      type: 'title',
      checked: false,
    });
  });

  it('cycles a task through open, done, then off', () => {
    const open = cycleBlockType(block('text'), 'task');
    expect(open).toMatchObject({ type: 'task', checked: false });

    const done = cycleBlockType(open, 'task');
    expect(done).toMatchObject({ type: 'task', checked: true });

    expect(cycleBlockType(done, 'task').type).toBe('text');
  });

  it('keeps the text of the line through every change', () => {
    let current = block('text');
    for (const command of ['title', 'topic', 'task', 'task', 'task'] as const) {
      current = cycleBlockType(current, command);
      expect(blockPlainText(current)).toBe('x');
    }
  });
});

describe('rendering to the editing surface', () => {
  it('emits one block element per line, carrying its type', () => {
    expect(toHtml('# Plans\nplain')).toBe(
      '<div data-line="title">Plans</div><div data-line="text">plain</div>',
    );
  });

  it('carries the tick state only on task lines', () => {
    expect(toHtml('- [x] done')).toBe('<div data-line="task" data-checked="true">done</div>');
    expect(toHtml('- [ ] open')).toBe('<div data-line="task" data-checked="false">open</div>');
    expect(toHtml('- topic')).toBe('<div data-line="topic">topic</div>');
  });

  it('renders styled runs as real elements, not as markers', () => {
    const html = toHtml('See **you** in *June*');

    expect(html).toContain('<strong>you</strong>');
    expect(html).toContain('<em>June</em>');
    expect(html).not.toContain('**');
  });

  it('nests italic inside bold for a run that is both', () => {
    expect(blockToHtml({ type: 'text', checked: false, spans: [{ text: 'x', bold: true, italic: true }] })).toBe(
      '<div data-line="text"><strong><em>x</em></strong></div>',
    );
  });

  it('gives an empty line a br so it stays clickable', () => {
    expect(toHtml('')).toBe('<div data-line="text"><br></div>');
    expect(blocksToHtml([])).toBe('<div data-line="text"><br></div>');
  });

  it('escapes markup in the note so a note can never inject elements', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(toHtml('a < b & c > d')).toBe('<div data-line="text">a &lt; b &amp; c &gt; d</div>');
    expect(toHtml('<img src=x onerror=1>')).not.toContain('<img');
  });
});

describe('font size', () => {
  it('steps between the two bounds and stops there', () => {
    expect(changeNoteFontSize(NOTE_FONT_MIN_PX, -1)).toBe(NOTE_FONT_MIN_PX);
    expect(changeNoteFontSize(NOTE_FONT_MAX_PX, 1)).toBe(NOTE_FONT_MAX_PX);
    expect(changeNoteFontSize(NOTE_FONT_DEFAULT_PX, 1)).toBe(16);
    expect(changeNoteFontSize(NOTE_FONT_DEFAULT_PX, -1)).toBe(12);
  });

  it('walks the whole range in whole steps, never landing off-scale', () => {
    let size: number = NOTE_FONT_MIN_PX;
    const seen = [size];
    while (canGrowNoteFont(size)) {
      size = changeNoteFontSize(size, 1);
      seen.push(size);
    }
    expect(seen).toEqual([...NOTE_FONT_SIZES]);
  });

  it('reports when a button should be disabled', () => {
    expect(canShrinkNoteFont(NOTE_FONT_MIN_PX)).toBe(false);
    expect(canGrowNoteFont(NOTE_FONT_MAX_PX)).toBe(false);
    expect(canGrowNoteFont(NOTE_FONT_MIN_PX)).toBe(true);
  });

  it('snaps anything off-scale onto the nearest stop, so it can always be encoded', () => {
    expect(snapNoteFontSize(2)).toBe(NOTE_FONT_MIN_PX);
    expect(snapNoteFontSize(400)).toBe(NOTE_FONT_MAX_PX);
    expect(snapNoteFontSize(Number.NaN)).toBe(NOTE_FONT_DEFAULT_PX);
    expect(snapNoteFontSize(15)).toBe(14);
    expect(snapNoteFontSize(13.4)).toBe(14);
  });

  it('can serialize and re-parse every stop on the scale', () => {
    for (const size of NOTE_FONT_SIZES) {
      const line = formatInline([{ text: 'x', bold: false, italic: false, size }]);
      expect(line).toBe(`{{${size}}}x{{/}}`);
      expect(parseInline(line)).toEqual([{ text: 'x', bold: false, italic: false, size }]);
    }
  });

  it('reaches 24 by stepping up, and 12 by stepping down', () => {
    let size: number = NOTE_FONT_DEFAULT_PX;
    for (let step = 0; step < 20; step += 1) {
      size = changeNoteFontSize(size, 1);
    }
    expect(size).toBe(24);

    for (let step = 0; step < 20; step += 1) {
      size = changeNoteFontSize(size, -1);
    }
    expect(size).toBe(12);
  });

  it('only ever produces a size the serializer can round-trip', () => {
    for (const candidate of [0, 5, 13, 15, 17, 19, 99, Number.NaN]) {
      const snapped = snapNoteFontSize(candidate);
      expect(NOTE_FONT_SIZES).toContain(snapped);
      const line = formatInline([{ text: 'x', bold: false, italic: false, size: snapped }]);
      expect(parseInline(line)[0].size).toBe(snapped);
    }
  });
});

describe('reading a note back out', () => {
  const note = '# Plans\n- [x] book flights\n- [ ] pack\n- passport\nSee **you** in *June*.';

  it('strips every marker for the file name', () => {
    expect(toPlainText(note)).toBe('Plans\nbook flights\npack\npassport\nSee you in June.');
  });

  it('keeps structure legible in the thumbnail', () => {
    expect(toDisplayText(note)).toBe('Plans\n☑ book flights\n☐ pack\n• passport\nSee you in June.');
  });

  it('shows no markup characters in either form', () => {
    for (const rendered of [toPlainText(note), toDisplayText(note)]) {
      expect(rendered).not.toContain('#');
      expect(rendered).not.toContain('[ ]');
      expect(rendered).not.toContain('*');
    }
  });

  it('leaves a note with no formatting completely untouched', () => {
    const untouched = 'Dear Ana,\n\nThe safe code is 4417.';
    expect(toDisplayText(untouched)).toBe(untouched);
    expect(toPlainText(untouched)).toBe(untouched);
  });
});
