import { describe, expect, test } from "bun:test";
import { BANK } from "../../test/support";
import { boxAround } from "./geo";
import { type Candidate, streak, suggest } from "./views";

describe("streak", () => {
  test("counts back from this week through every week with a new street", () => {
    expect(streak([0, 2, 1, 3])).toBe(3);
    expect(streak([4, 0, 1, 3])).toBe(2);
    expect(streak([1, 1, 1])).toBe(3);
  });

  test("is not broken by a week still under way", () => {
    expect(streak([0, 2, 1, 0])).toBe(2);
    expect(streak([2, 0, 0])).toBe(0);
    expect(streak([])).toBe(0);
  });
});

describe("suggestions", () => {
  const street = (id: number, north: number, east: number, remaining = 5): Candidate => {
    const { north: lat, east: lon } = boxAround(BANK, 1);
    return {
      id,
      name: `Street ${id}`,
      centre: [BANK[0] + (lat - BANK[0]) * north, BANK[1] + (lon - BANK[1]) * east],
      remaining,
    };
  };

  test("a dense patch further off beats a lone street next door", () => {
    const patch = [1, 2, 3, 4].map((id) => street(id, 1_200 + id * 20, 1_200));
    const [first, second] = suggest(BANK, [street(9, 100, 0), ...patch]);

    expect(first?.streets.map(({ id }) => id).sort()).toEqual([1, 2, 3, 4]);
    expect(first?.distanceMetres).toBeGreaterThan(1_500);
    expect(second?.streets).toEqual([{ id: 9, name: "Street 9", remainingNodes: 5 }]);
  });

  test("lists a cluster's streets with the most left to run first", () => {
    const [only] = suggest(BANK, [street(1, 100, 100, 2), street(2, 110, 100, 9)]);

    expect(only?.streets.map(({ id }) => id)).toEqual([2, 1]);
  });
});
