import * as Y from 'yjs';

export const BODY_FRAGMENT = 'body';
export const META_MAP = 'meta';
export const TITLE_FIELD = 'title';

export function readTitle(doc: Y.Doc): string {
  const stored = doc.getMap(META_MAP).get(TITLE_FIELD);
  return typeof stored === 'string' ? stored : '';
}

export function writeTitle(doc: Y.Doc, title: string, origin?: unknown): void {
  doc.transact(() => {
    doc.getMap(META_MAP).set(TITLE_FIELD, title);
  }, origin);
}

export function readBodyText(doc: Y.Doc): string {
  return fragmentText(doc.getXmlFragment(BODY_FRAGMENT)).replace(/\n{3,}/g, '\n\n').trim();
}

function fragmentText(node: Y.XmlFragment | Y.XmlElement): string {
  let text = '';

  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      text += child.toString().replace(/<[^>]*>/g, '');
      continue;
    }
    if (child instanceof Y.XmlElement) {
      text += fragmentText(child);
      if (BLOCK_NODES.has(child.nodeName)) {
        text += '\n';
      }
      continue;
    }
    if (child instanceof Y.XmlHook) {
      continue;
    }
  }

  return text;
}

const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'taskItem',
  'codeBlock',
  'tableRow',
]);

export function isDocumentEmpty(doc: Y.Doc): boolean {
  return readTitle(doc).trim().length === 0 && readBodyText(doc).length === 0;
}
