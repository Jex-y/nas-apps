import { describe, expect, test } from "bun:test";
import { scaleOver, symmetricScale, ticks } from "./scale";

describe("scales", () => {
  test("span the values and 0, or just the values", () => {
    expect(scaleOver([2, 8], { padding: 0 })).toMatchObject({ min: 0, max: 8 });
    expect(scaleOver([2, 8], { padding: 0, withZero: false })).toMatchObject({ min: 2, max: 8 });
  });

  test("place 0 at the centre when symmetric", () => {
    expect(symmetricScale([3, -1]).at(0)).toBe(50);
  });
});

describe("ticks", () => {
  test("are round numbers, several of them, whatever the span", () => {
    for (const reach of [0.3, 1.3, 2.4, 4.6, 9, 23]) {
      const values = ticks(symmetricScale([reach]), 4);
      expect(values.length).toBeGreaterThanOrEqual(3);
      expect(values).toContain(0);
    }
  });

  test("the case that left only 0 on a scale of ±4.6", () => {
    expect(ticks({ min: -4.58, max: 4.58, at: () => 0 }, 4)).toEqual([-4, -2, 0, 2, 4]);
  });
});
