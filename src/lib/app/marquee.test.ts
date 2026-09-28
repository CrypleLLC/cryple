import { describe, expect, it } from 'vitest';
import {
  boxBetween,
  boxesTouch,
  hasTravelled,
  idsInBox,
  marqueeSelection,
} from './index';

const tile = (id: string, left: number, top: number) => ({
  id,
  box: { left, top, right: left + 100, bottom: top + 100 },
});

describe('the selection box', () => {
  it('is the same box whichever corner the drag started from', () => {
    const box = { left: 10, top: 20, right: 110, bottom: 220 };
    expect(boxBetween({ x: 10, y: 20 }, { x: 110, y: 220 })).toEqual(box);
    expect(boxBetween({ x: 110, y: 220 }, { x: 10, y: 20 })).toEqual(box);
    expect(boxBetween({ x: 110, y: 20 }, { x: 10, y: 220 })).toEqual(box);
  });

  it('starts only once the pointer has moved, so a click on the background stays a click', () => {
    expect(hasTravelled({ x: 0, y: 0 }, { x: 2, y: 3 })).toBe(false);
    expect(hasTravelled({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(true);
    expect(hasTravelled({ x: 10, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });

  it('selects every tile it touches, not only those it covers', () => {
    const tiles = [tile('a', 0, 0), tile('b', 120, 0), tile('c', 0, 120)];

    expect(idsInBox(tiles, { left: 90, top: 90, right: 130, bottom: 95 })).toEqual(['a', 'b']);
    expect(idsInBox(tiles, { left: 101, top: 101, right: 119, bottom: 119 })).toEqual([]);
  });

  it('does not count sharing an edge as touching', () => {
    expect(boxesTouch({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  });
});

describe('what the drag leaves selected', () => {
  it('replaces the selection with what the box touches', () => {
    expect(marqueeSelection(['x', 'y'], ['a', 'b'], false)).toEqual(['a', 'b']);
    expect(marqueeSelection(['x'], [], false)).toEqual([]);
  });

  it('adds to the selection with a modifier held, without doubling an id', () => {
    expect(marqueeSelection(['x', 'a'], ['a', 'b'], true)).toEqual(['x', 'a', 'b']);
  });
});
