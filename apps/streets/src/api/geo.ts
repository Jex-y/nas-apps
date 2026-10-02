/** A WGS84 position in degrees, in the order Strava streams and Leaflet use. */
export type LatLon = readonly [lat: number, lon: number];

export type Box = {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
};

const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance; exact enough at street scale that no projection is needed. */
export const haversineMetres = ([lat1, lon1]: LatLon, [lat2, lon2]: LatLon): number => {
  const h =
    Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
};

/** Greater London (every borough's extent) with a small margin; everything spatial is indexed within it. */
export const LONDON: Box = { south: 51.27, west: -0.52, north: 51.7, east: 0.34 };

/** Taken at London's northern edge, where a degree of longitude is shortest, so no cell is narrower than asked. */
const LONDON_COS = Math.cos(radians(LONDON.north));

export const boxesOverlap = (a: Box, b: Box): boolean =>
  a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;

/** The square of `metres` either side of a point. */
export const boxAround = ([lat, lon]: LatLon, metres: number): Box => {
  const latSpan = metres / METRES_PER_DEGREE;
  const lonSpan = metres / (METRES_PER_DEGREE * Math.cos(radians(lat)));
  return { south: lat - latSpan, west: lon - lonSpan, north: lat + latSpan, east: lon + lonSpan };
};

export const contains = (box: Box, [lat, lon]: LatLon): boolean =>
  lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;

export const boxOf = (points: readonly LatLon[]): Box | null => {
  if (points.length === 0) {
    return null;
  }
  let [south, west] = points[0] as LatLon;
  let [north, east] = [south, west];
  for (const [lat, lon] of points) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return { south, west, north, east };
};

/**
 * Square cells of about `metres` over {@link LONDON}, numbered row-major from its south-west corner. Plain Postgres
 * has no spatial index, so a btree on a cell number stands in for one: a lookup asks for a handful of cells, then
 * checks exact distances in TypeScript.
 */
export const createGrid = (metres: number) => {
  const latStep = metres / METRES_PER_DEGREE;
  const lonStep = metres / (METRES_PER_DEGREE * LONDON_COS);
  const rows = Math.ceil((LONDON.north - LONDON.south) / latStep);
  const cols = Math.ceil((LONDON.east - LONDON.west) / lonStep);
  const rowOf = (lat: number) => Math.floor((lat - LONDON.south) / latStep);
  const colOf = (lon: number) => Math.floor((lon - LONDON.west) / lonStep);
  const clampRow = (row: number) => Math.min(rows - 1, Math.max(0, row));
  const clampCol = (col: number) => Math.min(cols - 1, Math.max(0, col));

  /** Cells in the given row and column ranges (inclusive), clipped to the grid. */
  const block = (rowFrom: number, colFrom: number, rowTo: number, colTo: number): number[] => {
    const cells: number[] = [];
    for (let row = clampRow(rowFrom); row <= clampRow(rowTo); row++) {
      for (let col = clampCol(colFrom); col <= clampCol(colTo); col++) {
        cells.push(row * cols + col);
      }
    }
    return cells;
  };

  return {
    metres,
    rows,
    cols,
    /** `null` outside London, where nothing is indexed. */
    cellOf: ([lat, lon]: LatLon): number | null => {
      const row = rowOf(lat);
      const col = colOf(lon);
      return row < 0 || row >= rows || col < 0 || col >= cols ? null : row * cols + col;
    },
    /** The cell and its eight neighbours: everything within `metres` of any point in the cell. */
    around: (cell: number): number[] => {
      const row = Math.floor(cell / cols);
      const col = cell % cols;
      return block(row - 1, col - 1, row + 1, col + 1);
    },
    /** Every cell overlapping the box, and `ring` more cells around it. */
    cellsIn: (box: Box, ring = 0): number[] =>
      boxesOverlap(box, LONDON)
        ? block(rowOf(box.south) - ring, colOf(box.west) - ring, rowOf(box.north) + ring, colOf(box.east) + ring)
        : [],
    block,
    /** The extent of a block of cells. */
    blockBox: (rowFrom: number, colFrom: number, rowTo: number, colTo: number): Box => ({
      south: LONDON.south + rowFrom * latStep,
      west: LONDON.west + colFrom * lonStep,
      north: LONDON.south + (rowTo + 1) * latStep,
      east: LONDON.west + (colTo + 1) * lonStep,
    }),
  };
};

export type Grid = ReturnType<typeof createGrid>;

/**
 * The grid behind every `cell` column. Street segments are cut to fit within one cell, so a viewport query only
 * needs the cells it overlaps plus one ring around them.
 */
export const CELLS = createGrid(250);

/** Square blocks of `size` × `size` cells of a grid, numbered row-major like the cells. */
export const createTiling = (grid: Grid, size: number) => {
  const cols = Math.ceil(grid.cols / size);
  return {
    count: Math.ceil(grid.rows / size) * cols,
    tileOf: (cell: number): number =>
      Math.floor(Math.floor(cell / grid.cols) / size) * cols + Math.floor((cell % grid.cols) / size),
    cellsOf: (tile: number): number[] => {
      const row = Math.floor(tile / cols) * size;
      const col = (tile % cols) * size;
      return grid.block(row, col, row + size - 1, col + size - 1);
    },
  };
};

/**
 * The map is fetched a tile of about 2 km at a time, so each is cached on its own and a pan only fetches the tiles it
 * brings into view. A segment belongs to the tile of its cell, so tiles never repeat one.
 */
export const MAP_TILES = createTiling(CELLS, 8);

/** Points strictly between `a` and `b`, evenly spaced so no gap exceeds `stepMetres`. */
export const between = (a: LatLon, b: LatLon, stepMetres: number): LatLon[] => {
  const parts = Math.ceil(haversineMetres(a, b) / stepMetres);
  return Array.from({ length: Math.max(0, parts - 1) }, (_, index) => {
    const t = (index + 1) / parts;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const;
  });
};

/** Splits a line into consecutive pieces no longer than `maxMetres`, each starting where the one before ended. */
export const cutLine = (line: readonly LatLon[], maxMetres: number): LatLon[][] => {
  const points = line.flatMap((point, index) => {
    const previous = line[index - 1];
    return previous === undefined ? [point] : [...between(previous, point, maxMetres), point];
  });
  const pieces: LatLon[][] = [];
  let piece: LatLon[] = [];
  let length = 0;
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const step = previous === undefined ? 0 : haversineMetres(previous, point);
    if (previous !== undefined && length + step > maxMetres) {
      pieces.push(piece);
      piece = [previous];
      length = 0;
    }
    piece.push(point);
    length += step;
  });
  return piece.length > 1 ? [...pieces, piece] : pieces;
};

/**
 * Fills in a track so consecutive points are at most `stepMetres` apart, except across gaps longer than
 * `maxGapMetres` (a paused watch, a tube ride), which are left open rather than credited as run.
 */
export const densify = (points: readonly LatLon[], stepMetres: number, maxGapMetres: number): LatLon[] =>
  points.flatMap((point, index) => {
    const previous = points[index - 1];
    return previous === undefined || haversineMetres(previous, point) > maxGapMetres
      ? [point]
      : [...between(previous, point, stepMetres), point];
  });

/**
 * Even–odd ray casting against every line of a boundary. The lines need not be joined into rings first: as long as
 * together they close, each crossing flips the parity whichever ring it belongs to, inner or outer.
 */
export const insideBoundary = ([lat, lon]: LatLon, lines: readonly (readonly LatLon[])[]): boolean => {
  let inside = false;
  for (const line of lines) {
    for (let index = 1; index < line.length; index++) {
      const [aLat, aLon] = line[index - 1] as LatLon;
      const [bLat, bLon] = line[index] as LatLon;
      if (aLat > lat !== bLat > lat && lon < aLon + ((lat - aLat) * (bLon - aLon)) / (bLat - aLat)) {
        inside = !inside;
      }
    }
  }
  return inside;
};
