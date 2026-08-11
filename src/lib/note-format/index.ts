export const TITLE_MARKER = '# ';
export const TOPIC_MARKER = '- ';
export const TASK_OPEN_MARKER = '- [ ] ';
export const TASK_DONE_MARKER = '- [x] ';

export const BOLD_MARK = '**';
export const ITALIC_MARK = '*';
export const BOLD_ITALIC_MARK = '***';

export const TOPIC_BULLET = '•';
export const TASK_OPEN_BULLET = '☐';
export const TASK_DONE_BULLET = '☑';

export const NOTE_FONT_SIZES = [12, 14, 16, 18, 20, 22, 24] as const;
export const NOTE_FONT_MIN_PX = NOTE_FONT_SIZES[0];
export const NOTE_FONT_MAX_PX = NOTE_FONT_SIZES[NOTE_FONT_SIZES.length - 1];
export const NOTE_FONT_DEFAULT_PX = 14;

export type NoteLineType = 'title' | 'topic' | 'task' | 'text';
export type NoteLineCommand = Exclude<NoteLineType, 'text'>;
export type InlineStyle = 'bold' | 'italic';

export interface InlineSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  size?: number;
}

export interface NoteBlock {
  type: NoteLineType;
  checked: boolean;
  spans: InlineSpan[];
}

interface NoteLine {
  type: NoteLineType;
  checked: boolean;
  text: string;
}

function parseLine(raw: string): NoteLine {
  if (raw.startsWith(TASK_DONE_MARKER)) {
    return { type: 'task', checked: true, text: raw.slice(TASK_DONE_MARKER.length) };
  }
  if (raw.startsWith(TASK_OPEN_MARKER)) {
    return { type: 'task', checked: false, text: raw.slice(TASK_OPEN_MARKER.length) };
  }
  if (raw.startsWith(TITLE_MARKER)) {
    return { type: 'title', checked: false, text: raw.slice(TITLE_MARKER.length) };
  }
  if (raw.startsWith(TOPIC_MARKER)) {
    return { type: 'topic', checked: false, text: raw.slice(TOPIC_MARKER.length) };
  }
  return { type: 'text', checked: false, text: raw };
}

function formatLine(line: NoteLine): string {
  switch (line.type) {
    case 'title':
      return TITLE_MARKER + line.text;
    case 'topic':
      return TOPIC_MARKER + line.text;
    case 'task':
      return (line.checked ? TASK_DONE_MARKER : TASK_OPEN_MARKER) + line.text;
    default:
      return line.text;
  }
}

const INLINE_PATTERN = /\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
const SIZE_PATTERN = new RegExp(
  `\\{\\{(${NOTE_FONT_SIZES.join('|')})\\}\\}([\\s\\S]*?)\\{\\{/\\}\\}`,
  'g',
);

function sized(span: InlineSpan, size: number | undefined): InlineSpan {
  return size === undefined ? span : { ...span, size };
}

function parseStyled(text: string, size: number | undefined): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let at = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index;
    if (index > at) {
      spans.push(sized({ text: text.slice(at, index), bold: false, italic: false }, size));
    }

    const [full, both, bold, italic] = match;
    if (both !== undefined) {
      spans.push(sized({ text: both, bold: true, italic: true }, size));
    } else if (bold !== undefined) {
      spans.push(sized({ text: bold, bold: true, italic: false }, size));
    } else {
      spans.push(sized({ text: italic, bold: false, italic: true }, size));
    }

    at = index + full.length;
  }

  if (at < text.length) {
    spans.push(sized({ text: text.slice(at), bold: false, italic: false }, size));
  }

  return spans;
}

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let at = 0;

  for (const match of text.matchAll(SIZE_PATTERN)) {
    const index = match.index;
    if (index > at) {
      spans.push(...parseStyled(text.slice(at, index), undefined));
    }
    spans.push(...parseStyled(match[2], Number(match[1])));
    at = index + match[0].length;
  }

  if (at < text.length) {
    spans.push(...parseStyled(text.slice(at), undefined));
  }

  return spans;
}

export function mergeSpans(spans: readonly InlineSpan[]): InlineSpan[] {
  const merged: InlineSpan[] = [];

  for (const span of spans) {
    if (span.text.length === 0) {
      continue;
    }
    const normalized =
      span.size === undefined ? span : { ...span, size: snapNoteFontSize(span.size) };

    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      last.bold === normalized.bold &&
      last.italic === normalized.italic &&
      last.size === normalized.size
    ) {
      last.text += normalized.text;
      continue;
    }
    merged.push({ ...normalized });
  }

  return merged;
}

function styleMarkers(span: InlineSpan): string {
  const mark = span.bold && span.italic
    ? BOLD_ITALIC_MARK
    : span.bold
      ? BOLD_MARK
      : span.italic
        ? ITALIC_MARK
        : '';
  return `${mark}${span.text}${mark}`;
}

export function formatInline(spans: readonly InlineSpan[]): string {
  const merged = mergeSpans(spans);
  let out = '';
  let index = 0;

  while (index < merged.length) {
    const { size } = merged[index];
    let end = index;
    while (end < merged.length && merged[end].size === size) {
      end += 1;
    }

    const run = merged.slice(index, end).map(styleMarkers).join('');
    out += size === undefined ? run : `{{${size}}}${run}{{/}}`;
    index = end;
  }

  return out;
}

export function parseBlocks(text: string): NoteBlock[] {
  return text.split('\n').map((raw) => {
    const line = parseLine(raw);
    return { type: line.type, checked: line.checked, spans: parseInline(line.text) };
  });
}

export function formatBlocks(blocks: readonly NoteBlock[]): string {
  return blocks
    .map((block) =>
      formatLine({ type: block.type, checked: block.checked, text: formatInline(block.spans) }),
    )
    .join('\n');
}

export function blockPlainText(block: NoteBlock): string {
  return block.spans.map((span) => span.text).join('');
}

export function cycleBlockType(block: NoteBlock, command: NoteLineCommand): NoteBlock {
  if (command === 'task') {
    if (block.type !== 'task') {
      return { ...block, type: 'task', checked: false };
    }
    return block.checked
      ? { ...block, type: 'text', checked: false }
      : { ...block, type: 'task', checked: true };
  }

  return block.type === command
    ? { ...block, type: 'text', checked: false }
    : { ...block, type: command, checked: false };
}

export function escapeHtml(text: string): string {
  return text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

function spanToHtml(span: InlineSpan): string {
  let html = escapeHtml(span.text);
  if (span.italic) {
    html = `<em>${html}</em>`;
  }
  if (span.bold) {
    html = `<strong>${html}</strong>`;
  }
  if (span.size !== undefined) {
    html = `<span style="font-size:${snapNoteFontSize(span.size)}px">${html}</span>`;
  }
  return html;
}

export function blockToHtml(block: NoteBlock): string {
  const merged = mergeSpans(block.spans);
  const inner = merged.length === 0 ? '<br>' : merged.map(spanToHtml).join('');
  const checked = block.type === 'task' ? ` data-checked="${block.checked}"` : '';

  return `<div data-line="${block.type}"${checked}>${inner}</div>`;
}

export function blocksToHtml(blocks: readonly NoteBlock[]): string {
  return blocks.length === 0
    ? blockToHtml({ type: 'text', checked: false, spans: [] })
    : blocks.map(blockToHtml).join('');
}

export function toHtml(text: string): string {
  return blocksToHtml(parseBlocks(text));
}

export function toPlainText(text: string): string {
  return parseBlocks(text).map(blockPlainText).join('\n');
}

export function toDisplayText(text: string): string {
  return parseBlocks(text)
    .map((block) => {
      const content = blockPlainText(block);
      if (block.type === 'topic') {
        return `${TOPIC_BULLET} ${content}`;
      }
      if (block.type === 'task') {
        return `${block.checked ? TASK_DONE_BULLET : TASK_OPEN_BULLET} ${content}`;
      }
      return content;
    })
    .join('\n');
}

export function snapNoteFontSize(size: number): number {
  if (!Number.isFinite(size)) {
    return NOTE_FONT_DEFAULT_PX;
  }
  return NOTE_FONT_SIZES.reduce((best, stop) =>
    Math.abs(stop - size) < Math.abs(best - size) ? stop : best,
  );
}

export function changeNoteFontSize(size: number, direction: 1 | -1): number {
  const at = NOTE_FONT_SIZES.indexOf(snapNoteFontSize(size) as (typeof NOTE_FONT_SIZES)[number]);
  const next = Math.min(NOTE_FONT_SIZES.length - 1, Math.max(0, at + direction));
  return NOTE_FONT_SIZES[next];
}

export function canGrowNoteFont(size: number): boolean {
  return snapNoteFontSize(size) < NOTE_FONT_MAX_PX;
}

export function canShrinkNoteFont(size: number): boolean {
  return snapNoteFontSize(size) > NOTE_FONT_MIN_PX;
}
