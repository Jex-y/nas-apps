import { describe, expect, test } from "bun:test";
import { MATCH_RADIUS_METRES, requiredNodes } from "../contract";
import { CELLS, createGrid, cutLine, haversineMetres, insideBoundary, type LatLon } from "./geo";
import { createMatcher, MAX_GAP_METRES } from "./matching";

/** A point `metres` north and east of another; flat-earth, which is exact enough over a few hundred metres. */
const offset = ([lat, lon]: LatLon, north: number, east: number): LatLon => [
  lat + north / 111_195,
  lon + east / (111_195 * Math.cos((lat * Math.PI) / 180)),
];

const BANK: LatLon = [51.5133, -0.0889];
const node = (id: number, [lat, lon]: LatLon) => ({ id, lat, lon });

describe("distance", () => {
  test("haversine agrees with known distances", () => {
    expect(haversineMetres([51, 0], [52, 0])).toBeCloseTo(111_195, -1);
    expect(haversineMetres(BANK, offset(BANK, 0, 100))).toBeCloseTo(100, 0);
    expect(haversineMetres(BANK, BANK)).toBe(0);
  });
});

describe("grid", () => {
  test("has no cells outside London", () => {
    expect(CELLS.cellOf([51.4, -1.5])).toBeNull();
    expect(CELLS.cellOf(BANK)).not.toBeNull();
  });

  test("cells are at least as wide as asked, even at London's northern edge", () => {
    const grid = createGrid(MATCH_RADIUS_METRES);
    const north: LatLon = [51.69, 0];
    const cell = grid.cellOf(north) ?? -1;
    // Walk east until the cell changes: that is one cell's width at most.
    let east = 0;
    while (grid.cellOf(offset(north, 0, east)) === cell) {
      east += 0.5;
    }
    const start = east;
    while (grid.cellOf(offset(north, 0, east)) === cell + 1) {
      east += 0.5;
    }
    expect(east - start).toBeGreaterThanOrEqual(MATCH_RADIUS_METRES - 0.5);
  });

  test("the ring around a cell is its eight neighbours, clipped at the grid's edge", () => {
    const cell = CELLS.cellOf(BANK) ?? -1;
    expect(CELLS.around(cell)).toHaveLength(9);
    expect(CELLS.around(cell)).toContain(cell + 1);
    expect(CELLS.around(cell)).toContain(cell - CELLS.cols);
    expect(CELLS.around(0)).toEqual([0, 1, CELLS.cols, CELLS.cols + 1]);
  });

  test("cutting a line keeps every piece within one cell of its start", () => {
    const line = [BANK, offset(BANK, 0, 400), offset(BANK, 300, 400)];
    const pieces = cutLine(line, CELLS.metres);
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) {
      const length = piece
        .slice(1)
        .reduce((total, point, index) => total + haversineMetres(piece[index] as LatLon, point), 0);
      expect(length).toBeLessThanOrEqual(CELLS.metres + 1e-6);
    }
    expect(pieces.at(-1)?.at(-1)).toEqual(line.at(-1) as LatLon);
  });
});

describe("matching", () => {
  const track = [BANK, offset(BANK, 0, 150)];

  test("hits nodes within the radius and misses those beyond", () => {
    const matcher = createMatcher(track);
    expect(
      matcher.hits([
        node(1, offset(BANK, MATCH_RADIUS_METRES - 1, 50)),
        node(2, offset(BANK, -(MATCH_RADIUS_METRES - 1), 120)),
        node(3, offset(BANK, MATCH_RADIUS_METRES + 1, 100)),
        node(4, offset(BANK, 0, 150 + MATCH_RADIUS_METRES + 1)),
      ]),
    ).toEqual([1, 2]);
  });

  test("matches across a cell edge", () => {
    const grid = createGrid(MATCH_RADIUS_METRES);
    // Find a point just west of a cell boundary, and a node 20 m east of it, over the edge.
    let west = BANK;
    while (grid.cellOf(offset(west, 0, 0.5)) === grid.cellOf(west)) {
      west = offset(west, 0, 0.5);
    }
    const across = offset(west, 0, 20);
    expect(grid.cellOf(across)).not.toBe(grid.cellOf(west));
    expect(createMatcher([west]).hits([node(1, across)])).toEqual([1]);
  });

  test("measures against the line between sparse fixes, not just the fixes", () => {
    const sparse = [BANK, offset(BANK, 0, 120)];
    expect(createMatcher(sparse).hits([node(1, offset(BANK, 10, 60))])).toEqual([1]);
  });

  test("does not credit a gap in the track", () => {
    const gap = [BANK, offset(BANK, 0, MAX_GAP_METRES + 50)];
    expect(createMatcher(gap).hits([node(1, offset(BANK, 0, (MAX_GAP_METRES + 50) / 2))])).toEqual([]);
  });

  test("looks up the cells the track passes and the ring around them", () => {
    const cells = createMatcher(track).cells;
    const start = CELLS.cellOf(BANK) ?? -1;
    expect(cells).toEqual(expect.arrayContaining(CELLS.around(start)));
    expect(new Set(cells).size).toBe(cells.length);
  });

  test("ignores track points outside London", () => {
    expect(createMatcher([[48.85, 2.35]]).cells).toEqual([]);
  });
});

describe("completion threshold", () => {
  test("is 90% rounded up, so short streets need every node", () => {
    expect(requiredNodes(1)).toBe(1);
    expect(requiredNodes(5)).toBe(5);
    expect(requiredNodes(9)).toBe(9);
    expect(requiredNodes(10)).toBe(9);
    expect(requiredNodes(11)).toBe(10);
    expect(requiredNodes(100)).toBe(90);
    expect(requiredNodes(101)).toBe(91);
  });
});

describe("boroughs", () => {
  const square = (south: number, west: number, size: number): LatLon[] => [
    [south, west],
    [south, west + size],
    [south + size, west + size],
    [south + size, west],
    [south, west],
  ];

  test("finds points inside a boundary made of unjoined ways, with a hole", () => {
    const outer = square(51.5, -0.1, 0.02);
    const hole = square(51.505, -0.095, 0.005);
    const lines = [outer.slice(0, 3), outer.slice(2), hole];
    expect(insideBoundary([51.5075, -0.0925], lines)).toBe(false);
    expect(insideBoundary([51.502, -0.098], lines)).toBe(true);
    expect(insideBoundary([51.53, -0.09], lines)).toBe(false);
  });
});
