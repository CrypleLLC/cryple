import type { Node as PMNode } from '@tiptap/pm/model';

export interface OutlineEntry {
  pos: number;
  level: number;
  text: string;
}

export interface OutlineNode extends OutlineEntry {
  children: OutlineNode[];
}

export function readOutline(doc: PMNode): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      entries.push({ pos, level: node.attrs.level as number, text: node.textContent });
    }
    return false;
  });

  return entries;
}

export function outlineTree(entries: readonly OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const entry of entries) {
    const node: OutlineNode = { ...entry, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }

    stack.push(node);
  }

  return roots;
}

export function activeHeadingPos(
  entries: readonly OutlineEntry[],
  cursor: number,
): number | undefined {
  let active: number | undefined;

  for (const entry of entries) {
    if (entry.pos > cursor) {
      break;
    }
    active = entry.pos;
  }

  return active;
}
