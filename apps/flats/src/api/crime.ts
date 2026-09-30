import { PermanentJobError } from "@apps/core";
import { z } from "zod";
import type { Coordinates } from "./places";

/** Near enough to be the flat's own streets, far enough to smooth over a single busy corner. */
export const CRIME_RADIUS_METRES = 400;
/** A year evens out the seasons. */
export const CRIME_MONTHS = 12;

export type CrimeReport = {
  readonly id: number;
  /** `YYYY-MM`. */
  readonly month: string;
  readonly category: string;
  readonly latitude: number;
  readonly longitude: number;
};

export type Bounds = {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
};

export type CrimeRecords = {
  /** The latest month the police have published, `YYYY-MM`. */
  readonly latestMonth: (signal: AbortSignal) => Promise<string>;
  /** Every street crime recorded in `month` inside `bounds`. */
  readonly inArea: (bounds: Bounds, month: string, signal: AbortSignal) => Promise<readonly CrimeReport[]>;
};

export const METRES_PER_DEGREE = 111_320;

/**
 * The grid crime is fetched by, about 1.1 km by 1 km in London: each tile is fetched once a month, whichever
 * properties it is near, and small enough to stay well inside police.uk's 10,000 crimes a request.
 */
const TILE_LATITUDE = 0.01;
const TILE_LONGITUDE = 0.015;

export type Tile = { readonly key: string; readonly bounds: Bounds };

const tileAt = (row: number, column: number): Tile => ({
  key: `${row}:${column}`,
  bounds: {
    south: row * TILE_LATITUDE,
    west: column * TILE_LONGITUDE,
    north: (row + 1) * TILE_LATITUDE,
    east: (column + 1) * TILE_LONGITUDE,
  },
});

/** Degrees of latitude and longitude spanning `metres` at `latitude`. */
export const degreesAcross = (latitude: number, metres: number) => ({
  latitude: metres / METRES_PER_DEGREE,
  longitude: metres / (METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180)),
});

/** Every tile the circle of `radiusMetres` around `at` touches. */
export const tilesAround = (at: Coordinates, radiusMetres: number): Tile[] => {
  const span = degreesAcross(at.latitude, radiusMetres);
  const firstRow = Math.floor((at.latitude - span.latitude) / TILE_LATITUDE);
  const lastRow = Math.floor((at.latitude + span.latitude) / TILE_LATITUDE);
  const firstColumn = Math.floor((at.longitude - span.longitude) / TILE_LONGITUDE);
  const lastColumn = Math.floor((at.longitude + span.longitude) / TILE_LONGITUDE);
  return Array.from({ length: lastRow - firstRow + 1 }, (_, row) =>
    Array.from({ length: lastColumn - firstColumn + 1 }, (_, column) => tileAt(firstRow + row, firstColumn + column)),
  ).flat();
};

/** The `count` months to `through`, oldest first: `("2026-02", 3)` → `2025-12, 2026-01, 2026-02`. */
export const monthsTo = (through: string, count: number): string[] => {
  const [year, month] = through.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  });
};

/** A rectangle in police.uk's `lat,lng:lat,lng` polygon form. */
const polygon = ({ south, west, north, east }: Bounds) =>
  [
    [south, west],
    [north, west],
    [north, east],
    [south, east],
  ]
    .map(([latitude, longitude]) => `${latitude?.toFixed(6)},${longitude?.toFixed(6)}`)
    .join(":");

const LastUpdated = z.object({ date: z.string().regex(/^\d{4}-\d{2}/) });
const StreetCrimes = z.array(
  z.object({
    id: z.number(),
    month: z.string(),
    category: z.string(),
    location: z.object({ latitude: z.coerce.number(), longitude: z.coerce.number() }),
  }),
);

/** Rate limits and outages pass; anything else is a request the police will keep refusing. */
const failure = (response: Response, what: string) =>
  response.status === 429 || response.status >= 500
    ? new Error(`police.uk ${what} failed: ${response.status}`)
    : new PermanentJobError(`police.uk refused the ${what} request: ${response.status}`);

const HOUR = 60 * 60_000;
/** police.uk rate-limits without saying how hard; five a second, one after another, stays well clear. */
const SPACING_MS = 200;
/** Waits after a 429 before trying again; after the last, the job fails and the queue retries it later. */
const BACKOFF_MS = [2_000, 4_000, 8_000];

export type PoliceUkOptions = {
  readonly send?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

/**
 * data.police.uk, which needs no key. Requests from every job in the process share one queue, spaced apart, and a
 * rate-limited one waits and tries again; the latest month is cached for an hour, since it changes monthly.
 */
export const createPoliceUk = ({
  send = fetch,
  now = Date.now,
  sleep = Bun.sleep,
}: PoliceUkOptions = {}): CrimeRecords => {
  let latest: { readonly month: string; readonly at: number } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  /** One request at a time, `SPACING_MS` apart, retrying a 429 after each of `BACKOFF_MS`. */
  const request = (input: string | URL, signal: AbortSignal): Promise<Response> => {
    const attempt = async (waits: readonly number[]): Promise<Response> => {
      const response = await send(input, { signal });
      await sleep(SPACING_MS);
      const [wait, ...rest] = waits;
      if (response.status !== 429 || wait === undefined) {
        return response;
      }
      await sleep(wait);
      return attempt(rest);
    };
    const turn = queue.then(() => attempt(BACKOFF_MS));
    queue = turn.catch(() => undefined);
    return turn;
  };

  return {
    latestMonth: async (signal) => {
      if (latest !== null && now() - latest.at < HOUR) {
        return latest.month;
      }
      const response = await request("https://data.police.uk/api/crime-last-updated", signal);
      if (!response.ok) {
        throw failure(response, "last-updated");
      }
      const month = LastUpdated.parse(await response.json()).date.slice(0, 7);
      latest = { month, at: now() };
      return month;
    },
    inArea: async (bounds, month, signal) => {
      const url = new URL("https://data.police.uk/api/crimes-street/all-crime");
      url.search = new URLSearchParams({ poly: polygon(bounds), date: month }).toString();
      const response = await request(url, signal);
      if (!response.ok) {
        throw failure(response, "street crime");
      }
      return StreetCrimes.parse(await response.json()).map(({ id, category, location }) => ({
        id,
        month,
        category,
        latitude: location.latitude,
        longitude: location.longitude,
      }));
    },
  };
};
