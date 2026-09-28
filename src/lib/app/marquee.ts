export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const MARQUEE_THRESHOLD_PIXELS = 4;

export function boxBetween(from: Point, to: Point): Box {
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    right: Math.max(from.x, to.x),
    bottom: Math.max(from.y, to.y),
  };
}

export function hasTravelled(from: Point, to: Point, threshold = MARQUEE_THRESHOLD_PIXELS): boolean {
  return Math.abs(to.x - from.x) >= threshold || Math.abs(to.y - from.y) >= threshold;
}

export function boxesTouch(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function idsInBox(items: readonly { id: string; box: Box }[], marquee: Box): string[] {
  return items.filter((item) => boxesTouch(item.box, marquee)).map((item) => item.id);
}

export function marqueeSelection(
  before: readonly string[],
  touched: readonly string[],
  additive: boolean,
): string[] {
  return additive ? [...new Set([...before, ...touched])] : [...touched];
}
