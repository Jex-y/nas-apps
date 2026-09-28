/**
 * Pixel art as text: each string is a row, each character a palette key, `.` is transparent. Art is drawn on a
 * small canvas of colours and turned into one SVG path per colour, so it stays crisp at any size.
 */
export type Grid = readonly string[];
export type Palette = Readonly<Record<string, string>>;
export type Canvas = (string | null)[][];

export const TRANSPARENT = ".";

/** Completes a symmetric sprite from its left half. */
export const mirrored = (half: Grid): Grid => half.map((row) => row + [...row].reverse().join(""));

export const flipped = (grid: Grid): Grid => grid.map((row) => [...row].reverse().join(""));

/** Light from the top left: body pixels against the outline on their right or below fall into shade. */
export const shaded = (grid: Grid, body = "b", outline = "o", shade = "s"): Grid =>
  grid.map((row, y) =>
    [...row]
      .map((key, x) => (key === body && (row[x + 1] === outline || grid[y + 1]?.[x] === outline) ? shade : key))
      .join(""),
  );

export const widthOf = (grid: Grid): number => grid[0]?.length ?? 0;

export const createCanvas = (width: number, height: number): Canvas =>
  Array.from({ length: height }, () => Array<string | null>(width).fill(null));

/** Draws `grid` with its top-left at (x, y), clipping at the canvas edges; unknown keys are an authoring error. */
export const blit = (canvas: Canvas, grid: Grid, x: number, y: number, palette: Palette): void => {
  grid.forEach((row, dy) => {
    [...row].forEach((key, dx) => {
      if (key === TRANSPARENT) {
        return;
      }
      const colour = palette[key];
      if (colour === undefined) {
        throw new Error(`No colour for "${key}"`);
      }
      const line = canvas[y + dy];
      if (line !== undefined && x + dx >= 0 && x + dx < line.length) {
        line[x + dx] = colour;
      }
    });
  });
};

/** One path per colour, each run of same-coloured pixels in a row one rectangle. */
export const toPaths = (canvas: Canvas): { fill: string; d: string }[] => {
  const runs = new Map<string, string[]>();
  canvas.forEach((line, y) => {
    let x = 0;
    while (x < line.length) {
      const colour = line[x];
      let end = x + 1;
      while (end < line.length && line[end] === colour) {
        end++;
      }
      if (colour != null) {
        const segments = runs.get(colour) ?? [];
        segments.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
        runs.set(colour, segments);
      }
      x = end;
    }
  });
  return [...runs].map(([fill, segments]) => ({ fill, d: segments.join("") }));
};

const channels = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** Blends `amount` of `toward` into `colour`, both `#rrggbb`. */
export const mix = (colour: string, toward: string, amount: number): string => {
  const [from, to] = [channels(colour), channels(toward)];
  return `#${from
    .map((channel, index) => Math.round(channel + ((to[index] ?? channel) - channel) * amount))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
};
