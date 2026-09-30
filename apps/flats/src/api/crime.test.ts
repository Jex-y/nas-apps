import { describe, expect, test } from "bun:test";
import { PermanentJobError } from "@apps/core";
import { CRIME_RADIUS_METRES, createPoliceUk, METRES_PER_DEGREE, monthsTo, tilesAround } from "./crime";

const DALSTON = { latitude: 51.5485, longitude: -0.0555 };
const TILE = { south: 51.54, west: -0.06, north: 51.55, east: -0.045 };

describe("the crime grid", () => {
  test("covers every point within the radius of a property", () => {
    const tiles = tilesAround(DALSTON, CRIME_RADIUS_METRES);
    const inside = (latitude: number, longitude: number) =>
      tiles.some(
        ({ bounds }) =>
          latitude >= bounds.south && latitude < bounds.north && longitude >= bounds.west && longitude < bounds.east,
      );

    for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
      const north = (CRIME_RADIUS_METRES / METRES_PER_DEGREE) * Math.sin(angle);
      const east =
        (CRIME_RADIUS_METRES / (METRES_PER_DEGREE * Math.cos((DALSTON.latitude * Math.PI) / 180))) * Math.cos(angle);
      expect(inside(DALSTON.latitude + north * 0.999, DALSTON.longitude + east * 0.999)).toBe(true);
    }
  });

  test("gives neighbouring properties the same tiles", () => {
    const next = { latitude: DALSTON.latitude + 0.0005, longitude: DALSTON.longitude + 0.0005 };
    const keys = (at: typeof DALSTON) => tilesAround(at, CRIME_RADIUS_METRES).map((tile) => tile.key);

    expect(keys(next).filter((key) => keys(DALSTON).includes(key)).length).toBeGreaterThan(0);
  });

  test("covers the months up to the latest, across a new year", () => {
    expect(monthsTo("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsTo("2026-07", 12)).toHaveLength(12);
  });
});

describe("police.uk", () => {
  const replying = (...responses: Response[]) => {
    const asked: string[] = [];
    const send = (async (input: string | URL) => {
      asked.push(String(input));
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("no more responses");
      }
      return response;
    }) as typeof fetch;
    return { send, asked };
  };
  const signal = new AbortController().signal;
  const instant = async () => {};
  const crimeAt = (id: number, category: string) => ({
    id,
    category,
    month: "2026-06",
    location: { latitude: "51.548925", longitude: "-0.077139", street: { id: 1, name: "On or near Bailey Place" } },
  });

  test("lists a tile's crimes for a month, each with its id and place", async () => {
    const { send, asked } = replying(Response.json([crimeAt(7, "burglary"), crimeAt(8, "drugs")]));

    expect(await createPoliceUk({ send, sleep: instant }).inArea(TILE, "2026-06", signal)).toEqual([
      { id: 7, month: "2026-06", category: "burglary", latitude: 51.548925, longitude: -0.077139 },
      { id: 8, month: "2026-06", category: "drugs", latitude: 51.548925, longitude: -0.077139 },
    ]);
    const url = new URL(asked[0] ?? "");
    expect(url.pathname).toBe("/api/crimes-street/all-crime");
    expect(url.searchParams.get("date")).toBe("2026-06");
    expect(url.searchParams.get("poly")).toBe(
      "51.540000,-0.060000:51.550000,-0.060000:51.550000,-0.045000:51.540000,-0.045000",
    );
  });

  test("asks for the latest month once an hour", async () => {
    let now = 0;
    const { send, asked } = replying(Response.json({ date: "2026-07-01" }), Response.json({ date: "2026-08-01" }));
    const police = createPoliceUk({ send, now: () => now, sleep: instant });

    expect(await police.latestMonth(signal)).toBe("2026-07");
    now = 30 * 60_000;
    expect(await police.latestMonth(signal)).toBe("2026-07");
    now = 61 * 60_000;
    expect(await police.latestMonth(signal)).toBe("2026-08");
    expect(asked).toHaveLength(2);
  });

  test("waits out a rate limit and tries again", async () => {
    const slept: number[] = [];
    const { send, asked } = replying(new Response(null, { status: 429 }), Response.json([crimeAt(1, "drugs")]));
    const police = createPoliceUk({ send, sleep: async (ms) => void slept.push(ms) });

    expect(await police.inArea(TILE, "2026-06", signal)).toHaveLength(1);
    expect(asked).toHaveLength(2);
    expect(slept).toEqual([200, 2_000, 200]);
  });

  test("sends one request at a time, however many jobs ask at once", async () => {
    let inFlight = 0;
    let most = 0;
    const send = (async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Bun.sleep(1);
      inFlight -= 1;
      return Response.json([]);
    }) as unknown as typeof fetch;
    const police = createPoliceUk({ send, sleep: instant });

    await Promise.all(["2026-01", "2026-02", "2026-03"].map((month) => police.inArea(TILE, month, signal)));
    expect(most).toBe(1);
  });

  test("lets a rate limit or outage be retried, but not a refusal", async () => {
    const inArea = (status: number) =>
      createPoliceUk({
        send: replying(...Array.from({ length: 4 }, () => new Response(null, { status }))).send,
        sleep: instant,
      }).inArea(TILE, "2026-06", signal);

    await expect(inArea(429)).rejects.not.toBeInstanceOf(PermanentJobError);
    await expect(inArea(503)).rejects.not.toBeInstanceOf(PermanentJobError);
    await expect(inArea(400)).rejects.toBeInstanceOf(PermanentJobError);
  });
});
