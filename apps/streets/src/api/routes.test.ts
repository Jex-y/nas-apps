import { beforeEach, describe, expect, test } from "bun:test";
import { drainJobs, type RegisteredJob } from "@apps/core";
import { startTestServer, uniqueLogin } from "@apps/core/testing";
import type { z } from "zod";
import { BANK, createStreetsTestContext, fakeOverpass, fakeStrava, gpxRun, NOON, record } from "../../test/support";
import {
  ActivityList,
  MapView,
  NetworkStatus,
  Stats,
  StravaStatus,
  StreetNodeList,
  SuggestionList,
  UploadResult,
} from "../contract";
import { createStreetsApp } from "../module";
import { boxAround } from "./geo";

const testbed = createStreetsTestContext();
const { context, streetNamed } = testbed;
const strava = fakeStrava(() => NOON);

let jobs: readonly RegisteredJob[] = [];
const request = startTestServer((ctx) => {
  const app = createStreetsApp(ctx, { strava, overpass: fakeOverpass(), now: () => NOON });
  jobs = app.jobs;
  return [app];
}, context);
const unconfigured = startTestServer(
  (ctx) => [createStreetsApp(ctx, { strava: null, overpass: fakeOverpass(), now: () => NOON })],
  context,
);
const drain = () => drainJobs(context.sql, jobs);

const read = async <S extends z.ZodType>(path: string, schema: S, as: string): Promise<z.infer<S>> => {
  const response = await request(path, { as });
  expect(response.status).toBe(200);
  return schema.parse(await response.json());
};

const errorOf = async (response: Response) => [response.status, ((await response.json()) as { error: string }).error];

const query = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));

/** Strava's answer to an authorisation this login started here. */
const callback = async (as: string, answer: Record<string, string>, stateOwner = as) => {
  const start = await request("/streets/api/strava/connect", { as: stateOwner });
  const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state") ?? "";
  return request(`/streets/api/strava/callback?${query({ state, ...answer })}`, { as });
};

const GRANTED = { code: "good-code", scope: "read,activity:read_all" };

const upload = (as: string, ...files: File[]) => {
  const body = new FormData();
  for (const file of files) {
    body.append("file", file);
  }
  return request("/streets/api/uploads", { method: "POST", body, as });
};

const viewport = query(boxAround(BANK, 300));

beforeEach(() => {
  strava.history.length = 0;
  strava.tracks.clear();
  strava.calls.length = 0;
});

describe("streets api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/streets/api/stats")).status).toBe(401);
    expect((await request("/streets/api/network/refresh", { method: "POST" })).status).toBe(401);
  });

  test("without Strava credentials, says so and offers no connection", async () => {
    const me = uniqueLogin();
    const status = StravaStatus.parse(await (await unconfigured("/streets/api/strava", { as: me })).json());

    expect(status).toEqual({
      configured: false,
      connection: null,
      activities: { pending: 0, matched: 0, no_track: 0 },
    });
    expect(await errorOf(await unconfigured("/streets/api/strava/connect", { as: me }))).toEqual([
      503,
      "Strava is not configured on this server",
    ]);
  });
});

describe("connecting Strava", () => {
  test("sends the runner to Strava, and on their return stores the connection and imports their history", async () => {
    const me = uniqueLogin();
    record(strava, 1, "2026-09-21T07:00:00Z", ["Bartholomew Lane"]);

    const start = await request("/streets/api/strava/connect", { as: me });
    const authorize = new URL(start.headers.get("Location") ?? "");
    expect(start.status).toBe(302);
    expect(authorize.origin).toBe("https://strava.test");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${context.publicUrl}/streets/api/strava/callback`);

    const back = await callback(me, GRANTED);
    expect([back.status, back.headers.get("Location")]).toEqual([302, "/streets/connect?strava=connected"]);
    expect((await read("/streets/api/strava", StravaStatus, me)).connection).toMatchObject({
      athleteName: "Ed Runner",
      includeWalks: false,
      includeRides: false,
      backfill: "running",
    });

    await drain();
    const status = await read("/streets/api/strava", StravaStatus, me);
    expect(status.connection?.backfill).toBe("done");
    expect(status.activities).toEqual({ pending: 0, matched: 1, no_track: 0 });
  });

  test("refuses a callback another login started, or one with no code", async () => {
    const me = uniqueLogin();

    expect(await errorOf(await callback(me, GRANTED, uniqueLogin()))).toEqual([
      400,
      "This Strava authorisation expired or was not started here; connect again",
    ]);
    expect((await callback(me, { scope: GRANTED.scope })).status).toBe(400);
    expect(strava.calls).toEqual([]);
  });

  test("says when access was refused, or granted without the activities", async () => {
    const me = uniqueLogin();

    const denied = await callback(me, { error: "access_denied" });
    const narrow = await callback(me, { code: "good-code", scope: "read" });

    expect(denied.headers.get("Location")).toBe("/streets/connect?strava=denied");
    expect(narrow.headers.get("Location")).toBe("/streets/connect?strava=scope");
    expect((await read("/streets/api/strava", StravaStatus, me)).connection).toBeNull();
  });

  test("one Strava account belongs to one login", async () => {
    await callback(uniqueLogin(), GRANTED);

    expect(await errorOf(await callback(uniqueLogin(), GRANTED))).toEqual([
      409,
      "That Strava account is already connected to another login",
    ]);
  });

  test("counting walks or rides re-reads the history, and disconnecting revokes access", async () => {
    const me = uniqueLogin();
    const stranger = uniqueLogin();
    const patch = (change: object) =>
      request("/streets/api/strava", { method: "PATCH", body: JSON.stringify(change), as: me });
    await callback(me, GRANTED);
    await drain();
    record(strava, 2, "2026-09-20T07:00:00Z", ["Tokenhouse Yard"], { sportType: "Walk" });
    record(strava, 3, "2026-09-19T07:00:00Z", ["Lothbury"], { sportType: "Ride" });

    expect(StravaStatus.parse(await (await patch({ includeWalks: true })).json()).connection).toMatchObject({
      includeWalks: true,
      includeRides: false,
      backfill: "running",
    });
    await drain();
    expect((await read("/streets/api/activities", ActivityList, me)).map((run) => run.sportType)).toEqual(["Walk"]);

    expect(StravaStatus.parse(await (await patch({ includeRides: true })).json()).connection).toMatchObject({
      includeWalks: true,
      includeRides: true,
      backfill: "running",
    });
    await drain();
    expect((await read("/streets/api/activities", ActivityList, me)).map((run) => run.sportType)).toEqual([
      "Walk",
      "Ride",
    ]);
    expect((await patch({})).status).toBe(400);

    expect((await request("/streets/api/strava", { method: "DELETE", as: me })).status).toBe(204);
    expect(strava.calls.at(-1)).toMatch(/^deauthorize access-\d+$/);
    expect((await read("/streets/api/strava", StravaStatus, me)).connection).toBeNull();
    expect(await read("/streets/api/activities", ActivityList, me)).toHaveLength(2);

    for (const [method, path] of [
      ["DELETE", "/streets/api/strava"],
      ["POST", "/streets/api/strava/backfill"],
    ] as const) {
      expect(await errorOf(await request(path, { method, as: stranger }))).toEqual([404, "Strava is not connected"]);
    }
  });
});

describe("uploads", () => {
  test("imports GPX files, plain or gzipped, once each, and says which could not be read", async () => {
    const me = uniqueLogin();
    const run = new File([gpxRun], "morning.gpx");
    const zipped = new File([Bun.gzipSync(gpxRun.replace("Bank &amp; Monument loop", "Evening"))], "evening.gpx.gz");

    const first = await upload(me, run, zipped, new File(["<gpx></gpx>"], "notes.gpx"));
    expect(first.status).toBe(201);
    expect(UploadResult.parse(await first.json())).toEqual({
      imported: 2,
      duplicates: 0,
      failed: [{ filename: "notes.gpx", error: "No track points" }],
    });
    expect(UploadResult.parse(await (await upload(me, run)).json())).toMatchObject({ imported: 0, duplicates: 1 });

    await drain();
    const runs = await read("/streets/api/activities", ActivityList, me);
    expect(runs.map((activity) => [activity.name, activity.source, activity.status]).sort()).toEqual([
      ["Bank & Monument loop", "gpx", "matched"],
      ["Evening", "gpx", "matched"],
    ]);
    expect((await read("/streets/api/stats", Stats, me)).overall.nodesHit).toBeGreaterThan(0);
  });

  test("expects files", async () => {
    expect(await errorOf(await upload(uniqueLogin()))).toEqual([400, "Expected GPX files in the `file` field"]);
  });
});

describe("progress", () => {
  const runLane = async (me: string) => {
    record(strava, 1, "2026-09-21T07:00:00Z", ["Bartholomew Lane"], { name: "Lane and back" });
    await callback(me, GRANTED);
    await drain();
  };

  test("draws the streets in view in the runner's own colours", async () => {
    const me = uniqueLogin();
    await runLane(me);

    const mine = await read(`/streets/api/map?${viewport}`, MapView, me);
    const theirs = await read(`/streets/api/map?${viewport}`, MapView, uniqueLogin());
    const lane = (view: typeof mine) => view.streets.find((street) => street.name === "Bartholomew Lane");

    expect(lane(mine)).toMatchObject({ state: "complete", hitCount: lane(mine)?.nodeCount });
    expect(lane(mine)?.paths.flat().length).toBeGreaterThan(1);
    expect(lane(theirs)).toMatchObject({ state: "untouched", hitCount: 0 });
    expect(mine.streets.some((street) => street.state === "partial")).toBe(true);
  });

  test("only draws a viewport small enough to be worth drawing", async () => {
    const me = uniqueLogin();

    expect(await errorOf(await request(`/streets/api/map?${query(boxAround(BANK, 20_000))}`, { as: me }))).toEqual([
      400,
      "Zoom in to see streets",
    ]);
    expect((await request("/streets/api/map?south=51.6&west=0&north=51.5&east=0.1", { as: me })).status).toBe(400);
    expect((await request("/streets/api/map", { as: me })).status).toBe(400);
  });

  test("counts streets by borough and week, and remembers which run finished each", async () => {
    const me = uniqueLogin();
    await runLane(me);

    const stats = await read("/streets/api/stats", Stats, me);

    expect(stats.overall).toMatchObject({ streets: 28, completed: 1 });
    expect(stats.overall.nodesHit).toBeLessThan(stats.overall.nodes);
    expect(stats.boroughs).toEqual([{ id: 51800, name: "City of London", streets: 28, completed: 1 }]);
    expect(stats.recent).toEqual([
      {
        id: (await streetNamed("Bartholomew Lane")).id,
        name: "Bartholomew Lane",
        borough: "City of London",
        completedAt: "2026-09-21T07:00:00.000Z",
        activityName: "Lane and back",
      },
    ]);
    expect(stats.weeks).toHaveLength(52);
    expect(stats.weeks.at(-1)).toEqual({ week: "2026-09-21", streets: 1 });
    expect(stats.streakWeeks).toBe(1);
    expect((await read("/streets/api/activities", ActivityList, me))[0]).toMatchObject({ newStreets: 1 });
    expect((await read("/streets/api/stats", Stats, uniqueLogin())).overall).toMatchObject({
      completed: 0,
      nodesHit: 0,
    });
  });

  test("shows which of a street's nodes are run", async () => {
    const me = uniqueLogin();
    await runLane(me);
    const lane = await streetNamed("Bartholomew Lane");
    const yard = await streetNamed("Tokenhouse Yard");

    const run = await read(`/streets/api/streets/${lane.id}/nodes`, StreetNodeList, me);
    const unrun = await read(`/streets/api/streets/${yard.id}/nodes`, StreetNodeList, me);

    expect(run).toHaveLength(lane.nodeCount);
    expect(run.every((node) => node.hit)).toBe(true);
    expect(unrun.some((node) => node.hit)).toBe(false);
    expect((await request("/streets/api/streets/lane/nodes", { as: me })).status).toBe(404);
  });

  test("suggests unfinished streets near a start in London", async () => {
    const me = uniqueLogin();
    await runLane(me);
    const lane = await streetNamed("Bartholomew Lane");

    const suggestions = await read(
      `/streets/api/suggestions?${query({ lat: BANK[0], lon: BANK[1] })}`,
      SuggestionList,
      me,
    );
    const suggested = suggestions.flatMap((suggestion) => suggestion.streets.map((street) => street.id));

    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested).not.toContain(lane.id);
    expect(await errorOf(await request("/streets/api/suggestions?lat=48.85&lon=2.35", { as: me }))).toEqual([
      400,
      "That is outside London, where no streets are tracked",
    ]);
  });

  test("matches every run again on request", async () => {
    const me = uniqueLogin();
    await runLane(me);
    const before = await read("/streets/api/stats", Stats, me);

    expect((await request("/streets/api/activities/rematch", { method: "POST", as: me })).status).toBe(202);
    await drain();

    expect(await read("/streets/api/stats", Stats, me)).toEqual(before);
  });
});

describe("street network", () => {
  test("reports its size and its last import, and imports again on request", async () => {
    const me = uniqueLogin();
    const before = await read("/streets/api/network", NetworkStatus, me);

    expect(before).toMatchObject({ boroughs: 1, streets: 28 });
    expect(before.refresh?.finishedAt).not.toBeNull();
    expect(before.refresh?.tilesDone).toBe(before.refresh?.tiles ?? -1);

    expect((await request("/streets/api/network/refresh", { method: "POST", as: me })).status).toBe(202);
    await drain();

    const after = await read("/streets/api/network", NetworkStatus, me);
    expect(after).toMatchObject({ boroughs: 1, streets: 28, nodes: before.nodes });
    expect(after.refresh?.finishedAt).not.toBeNull();
  });
});
