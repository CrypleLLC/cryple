import {
  formatBlocks,
  snapNoteFontSize,
  NOTE_FONT_DEFAULT_PX,
  type InlineSpan,
  type NoteBlock,
  type NoteLineType,
} from '@/lib/note-format';

const SIZE_SENTINEL = 'xxx-large';

const LINE_TYPES: readonly NoteLineType[] = ['title', 'topic', 'task', 'text'];

function lineTypeOf(element: HTMLElement): NoteLineType {
  const value = element.dataset.line as NoteLineType | undefined;
  return value !== undefined && LINE_TYPES.includes(value) ? value : 'text';
}

function isBold(element: HTMLElement): boolean {
  if (element.nodeName === 'B' || element.nodeName === 'STRONG') {
    return true;
  }
  const weight = element.style.fontWeight;
  return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
}

function isItalic(element: HTMLElement): boolean {
  if (element.nodeName === 'I' || element.nodeName === 'EM') {
    return true;
  }
  return element.style.fontStyle === 'italic';
}

function sizeOf(element: HTMLElement): number | undefined {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(element.style.fontSize);
  return match === null ? undefined : snapNoteFontSize(Number(match[1]));
}

function collectSpans(
  node: Node,
  bold: boolean,
  italic: boolean,
  size: number | undefined,
  into: InlineSpan[],
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text.length > 0) {
      into.push(size === undefined ? { text, bold, italic } : { text, bold, italic, size });
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node as HTMLElement;
  if (element.nodeName === 'BR') {
    return;
  }

  for (const child of Array.from(element.childNodes)) {
    collectSpans(
      child,
      bold || isBold(element),
      italic || isItalic(element),
      sizeOf(element) ?? size,
      into,
    );
  }
}

export function readBlock(element: HTMLElement): NoteBlock {
  const spans: InlineSpan[] = [];
  for (const child of Array.from(element.childNodes)) {
    collectSpans(child, false, false, undefined, spans);
  }

  return {
    type: lineTypeOf(element),
    checked: element.dataset.checked === 'true',
    spans,
  };
}

export function readSurface(element: HTMLElement): string {
  const blocks: NoteBlock[] = [];
  let loose: InlineSpan[] = [];

  function flush(): void {
    if (loose.length > 0) {
      blocks.push({ type: 'text', checked: false, spans: loose });
      loose = [];
    }
  }

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && child.nodeName !== 'BR') {
      flush();
      blocks.push(readBlock(child as HTMLElement));
      continue;
    }
    collectSpans(child, false, false, undefined, loose);
  }
  flush();

  if (blocks.length === 0) {
    blocks.push({ type: 'text', checked: false, spans: [] });
  }

  return formatBlocks(blocks);
}

export function surfaceBlockAt(element: HTMLElement, node?: Node): HTMLElement | undefined {
  const start = node ?? window.getSelection()?.anchorNode ?? undefined;

  if (start === undefined || !element.contains(start)) {
    return undefined;
  }
  if (start === element) {
    return (element.firstElementChild as HTMLElement | null) ?? undefined;
  }

  let current: Node = start;
  while (current.parentNode !== null && current.parentNode !== element) {
    current = current.parentNode;
  }

  return current.parentNode === element ? (current as HTMLElement) : undefined;
}

export function sizeAtCaret(element: HTMLElement): number {
  const anchor = window.getSelection()?.anchorNode ?? undefined;
  if (anchor === undefined || !element.contains(anchor)) {
    return NOTE_FONT_DEFAULT_PX;
  }

  let current: Node | null = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentNode;
  while (current !== null && current !== element) {
    const size = sizeOf(current as HTMLElement);
    if (size !== undefined) {
      return size;
    }
    current = current.parentNode;
  }

  return NOTE_FONT_DEFAULT_PX;
}

export function applyFontSize(element: HTMLElement, size: number): void {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return;
  }

  if (selection.getRangeAt(0).collapsed) {
    const block = surfaceBlockAt(element);
    if (block === undefined) {
      return;
    }
    const whole = document.createRange();
    whole.selectNodeContents(block);
    selection.removeAllRanges();
    selection.addRange(whole);
  }

  document.execCommand('styleWithCSS', false, 'true');
  document.execCommand('fontSize', false, '7');

  const marked = Array.from(
    element.querySelectorAll<HTMLElement>(`[style*="${SIZE_SENTINEL}"], font[size="7"]`),
  );

  const replacements: HTMLElement[] = [];
  for (const node of marked) {
    const span = document.createElement('span');
    span.style.fontSize = `${snapNoteFontSize(size)}px`;
    while (node.firstChild !== null) {
      span.appendChild(node.firstChild);
    }
    node.replaceWith(span);
    replacements.push(span);
  }

  if (replacements.length > 0) {
    const last = replacements[replacements.length - 1];
    const range = document.createRange();
    range.setStart(replacements[0], 0);
    range.setEnd(last, last.childNodes.length);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

export function selectedBlocks(element: HTMLElement): HTMLElement[] {
  const fallback = () => {
    const single = surfaceBlockAt(element);
    return single === undefined ? [] : [single];
  };

  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return fallback();
  }

  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return fallback();
  }

  const touched = (Array.from(element.children) as HTMLElement[]).filter((block) =>
    range.intersectsNode(block),
  );

  return touched.length > 0 ? touched : fallback();
}
