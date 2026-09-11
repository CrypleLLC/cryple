export interface PaginationBlock {
  height: number;
  spacing: number;
  keepWithNext: boolean;
  breaksAfter: boolean;
}

export interface PageStart {
  index: number;
  fill: number;
}

export function paginate(
  blocks: readonly PaginationBlock[],
  pageHeight: number,
): PageStart[] {
  const starts: PageStart[] = [];
  if (pageHeight <= 0 || blocks.length === 0) {
    return starts;
  }

  const reach = new Float64Array(blocks.length + 1);
  for (let index = 0; index < blocks.length; index += 1) {
    reach[index + 1] = reach[index] + blocks[index].spacing + blocks[index].height;
  }

  const extent = (from: number, to: number): number =>
    to <= from ? 0 : reach[to] - reach[from] - blocks[from].spacing;

  let pageStart = 0;
  let index = 0;

  while (index < blocks.length) {
    if (index > pageStart && extent(pageStart, index + 1) > pageHeight) {
      let start = index;
      while (
        start > pageStart + 1 &&
        blocks[start - 1].keepWithNext &&
        extent(start - 1, index + 1) <= pageHeight
      ) {
        start -= 1;
      }

      starts.push({ index: start, fill: Math.max(0, pageHeight - extent(pageStart, start)) });
      pageStart = start;
      index = start;
    }

    if (blocks[index].breaksAfter && index + 1 < blocks.length) {
      starts.push({
        index: index + 1,
        fill: Math.max(0, pageHeight - extent(pageStart, index + 1)),
      });
      pageStart = index + 1;
    }

    index += 1;
  }

  return starts;
}

export function pageCount(starts: readonly PageStart[]): number {
  return starts.length + 1;
}

const FILL_TOLERANCE_PX = 1;

export function samePagination(
  left: readonly PageStart[],
  right: readonly PageStart[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (start, index) =>
        start.index === right[index].index &&
        Math.abs(start.fill - right[index].fill) < FILL_TOLERANCE_PX,
    )
  );
}
