import { expect, test } from "bun:test";
import { distanceToSegment, roundDegrees, touchesPolyline } from "./geometry";

test("measures to the nearest point of a segment, its ends included", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBe(3);
  expect(distanceToSegment({ x: 13, y: 4 }, a, b)).toBe(5);
  expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
});

test("an eraser touches a polyline anywhere along it, or a lone point near it", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  expect(touchesPolyline({ x: 12, y: 5 }, line, 2)).toBe(true);
  expect(touchesPolyline({ x: 5, y: 5 }, line, 2)).toBe(false);
  expect(touchesPolyline({ x: 1, y: 1 }, [{ x: 0, y: 0 }], 2)).toBe(true);
  expect(touchesPolyline({ x: 1, y: 1 }, [], 2)).toBe(false);
});

test("rounds coordinates to six decimal places", () => {
  expect(roundDegrees(51.476311234)).toBe(51.476311);
  expect(roundDegrees(-0.3244467)).toBe(-0.324447);
});
