import { describe, expect, it } from 'vitest';
import { activeHeadingPos, outlineTree, type OutlineEntry } from './outline';

function heading(pos: number, level: number, text = ''): OutlineEntry {
  return { pos, level, text };
}

describe('outline tree', () => {
  it('nests a well-formed hierarchy', () => {
    const roots = outlineTree([heading(0, 1), heading(10, 2), heading(20, 3), heading(30, 2)]);

    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((child) => child.pos)).toEqual([10, 30]);
    expect(roots[0].children[0].children.map((child) => child.pos)).toEqual([20]);
  });

  it('treats a document that starts at h2 as having h2 roots', () => {
    const roots = outlineTree([heading(0, 2), heading(10, 2)]);

    expect(roots.map((root) => root.pos)).toEqual([0, 10]);
    expect(roots.every((root) => root.children.length === 0)).toBe(true);
  });

  it('nests across a skipped level rather than dropping the heading', () => {
    const roots = outlineTree([heading(0, 1), heading(10, 3)]);

    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((child) => child.pos)).toEqual([10]);
  });

  it('reparents when a level climbs back above its predecessor', () => {
    const roots = outlineTree([heading(0, 3), heading(10, 1), heading(20, 2)]);

    expect(roots.map((root) => root.pos)).toEqual([0, 10]);
    expect(roots[1].children.map((child) => child.pos)).toEqual([20]);
  });

  it('keeps an untitled heading, because one is created before it is named', () => {
    const roots = outlineTree([heading(0, 1, '')]);

    expect(roots).toHaveLength(1);
    expect(roots[0].text).toBe('');
  });

  it('returns nothing for a document without headings', () => {
    expect(outlineTree([])).toEqual([]);
  });
});

describe('active heading', () => {
  const entries = [heading(0, 1), heading(10, 2), heading(30, 2)];

  it('is the last heading at or before the cursor', () => {
    expect(activeHeadingPos(entries, 20)).toBe(10);
  });

  it('is the heading itself when the cursor sits on it', () => {
    expect(activeHeadingPos(entries, 10)).toBe(10);
  });

  it('is undefined while the cursor is above the first heading', () => {
    expect(activeHeadingPos([heading(5, 1)], 2)).toBeUndefined();
  });

  it('is undefined when there are no headings', () => {
    expect(activeHeadingPos([], 100)).toBeUndefined();
  });
});
