import { describe, expect, it } from 'vitest';
import { pageCount, paginate, samePagination, type PaginationBlock } from './pagination';

const PAGE = 900;

function block(height: number, overrides: Partial<PaginationBlock> = {}): PaginationBlock {
  return { height, spacing: 20, keepWithNext: false, breaksAfter: false, ...overrides };
}

describe('pagination', () => {
  it('keeps a document that fits on one page', () => {
    const starts = paginate([block(300), block(300)], PAGE);

    expect(starts).toEqual([]);
    expect(pageCount(starts)).toBe(1);
  });

  it('breaks before the block that would overflow', () => {
    const starts = paginate([block(500), block(500)], PAGE);

    expect(starts).toEqual([{ index: 1, fill: 400 }]);
    expect(pageCount(starts)).toBe(2);
  });

  it('ignores the spacing above the first block on a page', () => {
    const starts = paginate([block(890), block(890)], PAGE);

    expect(starts[0]).toEqual({ index: 1, fill: 10 });
    expect(paginate([block(890), block(890), block(890)], PAGE)).toHaveLength(2);
  });

  it('counts the spacing between blocks that share a page', () => {
    expect(paginate([block(440), block(440)], PAGE)).toEqual([]);
    expect(paginate([block(450), block(450)], PAGE)).toEqual([{ index: 1, fill: 450 }]);
  });

  it('lets a block taller than a page start its own page and overflow', () => {
    const starts = paginate([block(300), block(2000)], PAGE);

    expect(starts).toEqual([{ index: 1, fill: 600 }]);
  });

  it('never reports a negative fill when the first block already overflows', () => {
    const starts = paginate([block(2000), block(300)], PAGE);

    expect(starts).toEqual([{ index: 1, fill: 0 }]);
  });
});

describe('headings at a page ending', () => {
  it('carries a dangling heading to the next page with its content', () => {
    const blocks = [block(600), block(80, { keepWithNext: true }), block(300)];
    const starts = paginate(blocks, PAGE);

    expect(starts).toEqual([{ index: 1, fill: 300 }]);
  });

  it('carries a run of stacked headings together', () => {
    const blocks = [
      block(600),
      block(80, { keepWithNext: true }),
      block(60, { keepWithNext: true }),
      block(300),
    ];

    expect(paginate(blocks, PAGE)).toEqual([{ index: 1, fill: 300 }]);
  });

  it('leaves the heading in place when carrying it would not help', () => {
    const blocks = [block(100), block(700, { keepWithNext: true }), block(300)];
    const starts = paginate(blocks, PAGE);

    expect(starts).toEqual([{ index: 2, fill: 80 }]);
  });

  it('never empties a page to rescue a heading that opens it', () => {
    const blocks = [block(80, { keepWithNext: true }), block(900)];

    expect(paginate(blocks, PAGE)).toEqual([{ index: 1, fill: 820 }]);
  });
});

describe('explicit page breaks', () => {
  it('ends the page even with room to spare', () => {
    const blocks = [block(100), block(0, { breaksAfter: true, spacing: 0 }), block(100)];

    expect(paginate(blocks, PAGE)).toEqual([{ index: 2, fill: 800 }]);
  });

  it('is a no-op at the end of the document', () => {
    const blocks = [block(100), block(0, { breaksAfter: true, spacing: 0 })];

    expect(paginate(blocks, PAGE)).toEqual([]);
  });

  it('starts the measurement of the following page from zero', () => {
    const blocks = [
      block(800),
      block(0, { breaksAfter: true, spacing: 0 }),
      block(800),
      block(800),
    ];

    expect(paginate(blocks, PAGE)).toEqual([
      { index: 2, fill: 100 },
      { index: 3, fill: 100 },
    ]);
  });
});

describe('comparing two paginations', () => {
  it('is the same when the indices and fills match', () => {
    expect(samePagination([{ index: 4, fill: 100 }], [{ index: 4, fill: 100.4 }])).toBe(true);
  });

  it('is different when a break moves to another block, even with the same fill', () => {
    expect(samePagination([{ index: 4, fill: 100 }], [{ index: 5, fill: 100 }])).toBe(false);
  });

  it('is different when a page is added or removed', () => {
    expect(samePagination([{ index: 4, fill: 100 }], [])).toBe(false);
  });

  it('is different when the fill moves by more than a pixel', () => {
    expect(samePagination([{ index: 4, fill: 100 }], [{ index: 4, fill: 130 }])).toBe(false);
  });
});

describe('cost on a long document', () => {
  function longDocument(blocks: number): PaginationBlock[] {
    return Array.from({ length: blocks }, (_, index) => ({
      height: 27,
      spacing: 12,
      keepWithNext: index % 20 === 0,
      breaksAfter: false,
    }));
  }

  it('stays linear rather than quadratic as the document grows', () => {
    const small = longDocument(2_000);
    const large = longDocument(20_000);

    const smallStart = performance.now();
    paginate(small, PAGE);
    const smallCost = performance.now() - smallStart;

    const largeStart = performance.now();
    const starts = paginate(large, PAGE);
    const largeCost = performance.now() - largeStart;

    expect(starts.length).toBeGreaterThan(700);
    expect(largeCost).toBeLessThan(Math.max(smallCost, 1) * 40);
  });

  it('paginates twenty thousand blocks without blocking', () => {
    const start = performance.now();
    paginate(longDocument(20_000), PAGE);

    expect(performance.now() - start).toBeLessThan(50);
  });
});
