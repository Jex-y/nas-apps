export type Point = { readonly x: number; readonly y: number };

/** Shortest distance from `p` to the segment `a`–`b`. */
export const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Whether `p` lies within `reach` of any part of the polyline through `line`. */
export const touchesPolyline = (p: Point, line: readonly Point[], reach: number): boolean =>
  line.some((point, index) => {
    const previous = line[index - 1];
    return (
      (previous === undefined ? Math.hypot(p.x - point.x, p.y - point.y) : distanceToSegment(p, previous, point)) <=
      reach
    );
  });

/** Six decimal places of a degree is about 10 cm: finer than any pen, and it keeps stored strokes small. */
export const roundDegrees = (degrees: number): number => Math.round(degrees * 1e6) / 1e6;
