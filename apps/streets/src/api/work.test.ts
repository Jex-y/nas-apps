import { describe, expect, test } from "bun:test";
import { uniqueLogin } from "@apps/core/testing";
import { and, count, desc, eq } from "drizzle-orm";
import {
  bankWays,
  boroughList,
  createStreetsPipeline,
  createStreetsTestContext,
  fakeOverpass,
  gpxRun,
  NOON,
  record,
} from "../../test/support";
import { requiredNodes } from "../contract";
import { boroughQuery, type Overpass } from "./overpass";
import { activities, boroughs, connections, nodes, refreshes, streetProgress, streets } from "./schema";
import { parseGpx } from "./track";
import { isActiveHour, isImported, OVERPASS_SPACING_MS } from "./work";

const testbed = createStreetsTestContext();
const { db, connect, streetNamed, importNetwork } = testbed;

const progressOn = async (login: string, name: string) => {
  const street = await streetNamed(name);
  const [progress] = await db
    .select()
    .from(streetProgress)
    .where(and(eq(streetProgress.streetId, street.id), eq(streetProgress.login, login)));
  return progress && { ...progress, nodeCount: street.nodeCount };
};

const runsOf = (login: string) =>
  db.select().from(activities).where(eq(activities.login, login)).orderBy(activities.startAt);

describe("what counts", () => {
  test("runs always, walks, hikes and rides only when opted in, and never anything done indoors", () => {
    const runsOnly = { walks: false, rides: false };
    const everything = { walks: true, rides: true };

    expect(isImported("Run", runsOnly)).toBe(true);
    expect(isImported("TrailRun", runsOnly)).toBe(true);
    expect(isImported("Walk", runsOnly)).toBe(false);
    expect(isImported("Ride", runsOnly)).toBe(false);
    expect(isImported("Hike", { walks: true, rides: false })).toBe(true);
    expect(isImported("Ride", { walks: true, rides: false })).toBe(false);
    expect(isImported("GravelRide", { walks: false, rides: true })).toBe(true);
    expect(isImported("Walk", { walks: false, rides: true })).toBe(false);
    expect(isImported("VirtualRun", everything)).toBe(false);
    expect(isImported("VirtualRide", everything)).toBe(false);
    expect(isImported("Swim", everything)).toBe(false);
  });

  test("Strava is polled between 7 and 23, London time", () => {
    expect(isActiveHour(new Date("2026-09-21T05:59:00Z"))).toBe(false);
    expect(isActiveHour(new Date("2026-09-21T06:00:00Z"))).toBe(true);
    expect(isActiveHour(new Date("2026-09-21T21:59:00Z"))).toBe(true);
    expect(isActiveHour(new Date("2026-09-21T22:00:00Z"))).toBe(false);
  });
});

describe("street network", () => {
  test("imports London's boroughs and the runnable streets inside them", async () => {
    const [refresh] = await db.select().from(refreshes);
    const names = (await db.select({ name: streets.name }).from(streets)).map((street) => street.name);

    expect(await db.select({ name: boroughs.name }).from(boroughs)).toEqual([{ name: "City of London" }]);
    expect(refresh?.tiles).toBeGreaterThan(0);
    expect(refresh?.tilesDone).toBe(refresh?.tiles);
    expect(refresh?.finishedAt).not.toBeNull();
    expect(names).toContain("Lombard Street");
    expect(names).toContain("Throgmorton Street");
    expect(names).toHaveLength(28);
  });

  test("adds nodes along a way wherever OpenStreetMap's own are over 50 m apart", async () => {
    const lane = await streetNamed("Bartholomew Lane");
    const keys = await db.select({ key: nodes.key }).from(nodes).where(eq(nodes.streetId, lane.id));

    expect(lane.nodeCount).toBe(keys.length);
    expect(keys.filter(({ key }) => key > 0)).toHaveLength(5);
    expect(keys.some(({ key }) => key < 0)).toBe(true);
  });

  test("a second import changes nothing, and one without a street drops it", async () => {
    const before = await db.select({ nodes: count() }).from(nodes);

    await importNetwork();
    expect(await db.select({ nodes: count() }).from(nodes)).toEqual(before);

    const { elements } = bankWays as { elements: { tags: { name: string } }[] };
    await importNetwork({ elements: elements.filter((way) => way.tags.name !== "Tokenhouse Yard") });
    const names = (await db.select({ name: streets.name }).from(streets)).map((street) => street.name);
    expect(names).not.toContain("Tokenhouse Yard");
    expect(names).toHaveLength(27);

    await importNetwork();
    expect(await db.select({ nodes: count() }).from(nodes)).toEqual(before);
  });

  test("asks Overpass for one borough at a time, and plans no tiles until it has them all", async () => {
    const start = new Date("2099-01-01T00:00:00Z");
    const hackney = {
      type: "relation",
      id: 51781,
      tags: { name: "London Borough of Hackney", "ref:gss": "E09000012" },
    };
    const recorded = fakeOverpass();
    const overpass: Overpass = {
      query: async (ql, signal, attempt) =>
        ql.includes("out tags")
          ? { elements: [...(boroughList as { elements: unknown[] }).elements, hackney] }
          : recorded.query(ql, signal, attempt),
    };
    const { work, drain } = createStreetsPipeline(testbed, { now: () => start, overpass });

    await work.refreshNetwork();
    await drain(start);

    const waiting = await testbed.context.sql`
      select run_at, payload from jobs.jobs where name = 'streets.fetch-borough' and state = 'pending'
    `;
    const [refresh] = await db.select().from(refreshes).orderBy(desc(refreshes.id)).limit(1);
    expect(recorded.asked).toEqual([boroughQuery(51800)]);
    expect(waiting).toEqual([
      {
        run_at: new Date(start.getTime() + OVERPASS_SPACING_MS),
        payload: { refreshId: refresh?.id ?? 0, boroughId: hackney.id },
      },
    ]);
    expect(refresh?.tiles).toBe(0);

    await importNetwork();
    expect(await db.select({ name: boroughs.name }).from(boroughs)).toEqual([{ name: "City of London" }]);
  });
});

describe("Strava import", () => {
  test("backfills the athlete's history: runs with GPS are matched and their streets completed, quietly", async () => {
    const login = uniqueLogin();
    await connect(login);
    const { work, strava, sent, drain } = createStreetsPipeline(testbed);
    record(strava, 1, "2026-09-01T07:00:00Z", ["Bartholomew Lane"]);
    record(strava, 2, "2026-09-02T07:00:00Z", []);
    record(strava, 3, "2026-09-03T07:00:00Z", ["Lothbury"], { sportType: "Ride" });
    record(strava, 4, "2026-09-04T07:00:00Z", ["Lothbury"], { manual: true });
    record(strava, 5, "2026-09-05T07:00:00Z", ["Tokenhouse Yard"], { sportType: "Walk" });

    await work.startBackfill(login);
    await drain();

    expect((await runsOf(login)).map((run) => [run.externalId, run.status])).toEqual([
      ["1", "matched"],
      ["2", "no_track"],
    ]);
    const lane = await progressOn(login, "Bartholomew Lane");
    expect(lane?.hitCount).toBe(lane?.nodeCount);
    expect(lane?.completedAt).toEqual(new Date("2026-09-01T07:00:00Z"));
    expect(await progressOn(login, "Tokenhouse Yard")).toBeUndefined();
    const [connection] = await db.select().from(connections).where(eq(connections.login, login));
    expect(connection?.backfill).toBe("done");
    expect(sent).toEqual([]);
  });

  test("walks and rides are imported once asked for", async () => {
    const login = uniqueLogin();
    await connect(login);
    await db.update(connections).set({ includeWalks: true, includeRides: true }).where(eq(connections.login, login));
    const { work, strava, drain } = createStreetsPipeline(testbed);
    record(strava, 5, "2026-09-05T07:00:00Z", ["Tokenhouse Yard"], { sportType: "Walk" });
    record(strava, 6, "2026-09-06T07:00:00Z", ["Lothbury"], { sportType: "Ride" });

    await work.startBackfill(login);
    await drain();

    expect((await progressOn(login, "Tokenhouse Yard"))?.completedAt).not.toBeNull();
    expect((await progressOn(login, "Lothbury"))?.completedAt).not.toBeNull();
  });

  test("a poll tells the runner about each new activity, once, and which streets it completed", async () => {
    const login = uniqueLogin();
    await connect(login);
    const { work, strava, sent, drain } = createStreetsPipeline(testbed);
    record(strava, 7, "2026-09-21T07:00:00Z", ["Bartholomew Lane", "Tokenhouse Yard"], { name: "Morning run" });

    await testbed.context.jobs.enqueue(work.definitions.poll, {});
    await drain();

    const total = (await db.select({ streets: count() }).from(streets))[0]?.streets ?? 0;
    expect(sent).toEqual([
      {
        login,
        title: "Morning run",
        message: `2 new streets · City of London now ${((2 / total) * 100).toFixed(1)}%`,
        clickUrl: "https://apps.example/streets/",
      },
    ]);
    const [connection] = await db.select().from(connections).where(eq(connections.login, login));
    expect(connection?.lastPolledAt).toEqual(NOON);

    record(strava, 8, "2026-09-21T09:00:00Z", ["Bartholomew Lane"], { name: "Same again" });
    await testbed.context.jobs.enqueue(work.definitions.poll, {});
    await drain();
    expect(sent.slice(1)).toEqual([
      { login, title: "Same again", message: "No new streets", clickUrl: "https://apps.example/streets/" },
    ]);

    await testbed.context.jobs.enqueue(work.definitions.poll, {});
    await drain();
    expect(sent).toHaveLength(2);
  });

  test("nothing is asked of Strava overnight", async () => {
    const login = uniqueLogin();
    await connect(login);
    const { work, strava, drain } = createStreetsPipeline(testbed, { now: () => new Date("2026-09-21T02:00:00Z") });

    await testbed.context.jobs.enqueue(work.definitions.poll, {});
    await drain();

    expect(strava.calls).toEqual([]);
  });

  test("an access token about to expire is refreshed first, and the new one kept", async () => {
    const login = uniqueLogin();
    await connect(login, new Date(NOON.getTime() + 60_000));
    const { work, strava, drain } = createStreetsPipeline(testbed);

    await work.startBackfill(login);
    await drain();

    expect(strava.calls).toEqual(["refresh refresh-0", "activities access-1 before=undefined after=undefined"]);
    const [connection] = await db.select().from(connections).where(eq(connections.login, login));
    expect(connection?.refreshToken).toBe("refresh-1");
  });

  test("over the rate limit, the import waits for the reset and then carries on", async () => {
    const login = uniqueLogin();
    await connect(login);
    const { work, strava, drain } = createStreetsPipeline(testbed);
    record(strava, 1, "2026-09-01T07:00:00Z", ["Bartholomew Lane"]);
    strava.limitedUntil = new Date("2099-01-01T00:15:30Z");

    await work.startBackfill(login);
    expect(await drain()).toEqual({ completed: 1, retrying: 0, dead: 0 });
    expect(await runsOf(login)).toEqual([]);

    strava.limitedUntil = null;
    await drain(new Date("2099-01-01T00:16:00Z"));
    expect((await runsOf(login)).map((run) => run.status)).toEqual(["matched"]);
  });

  test("a revoked authorisation is recorded, for the runner to connect again", async () => {
    const login = uniqueLogin();
    await connect(login, new Date(NOON.getTime() - 1));
    const { work, strava, drain } = createStreetsPipeline(testbed);
    strava.revoked = true;

    await work.startBackfill(login);

    expect(await drain()).toEqual({ completed: 0, retrying: 0, dead: 1 });
    const [connection] = await db.select().from(connections).where(eq(connections.login, login));
    expect(connection?.lastError).toBe("Strava no longer accepts this connection; connect again");
  });
});

describe("progress", () => {
  test("a street completes at the run that reached nine nodes in ten, whichever is matched first", async () => {
    const login = uniqueLogin();
    await connect(login);
    const { work, strava, drain } = createStreetsPipeline(testbed);
    const lothbury = await streetNamed("Lothbury");
    record(strava, 1, "2026-09-01T07:00:00Z", ["Lothbury"]);
    record(strava, 2, "2026-09-08T07:00:00Z", ["Lothbury"]);
    const whole = strava.tracks.get(1);
    strava.tracks.set(1, { latlng: whole?.latlng.slice(0, 3) ?? [], time: [0, 5, 10] });

    await work.startBackfill(login);
    await drain();

    const progress = await progressOn(login, "Lothbury");
    const [first, second] = await runsOf(login);
    expect(requiredNodes(lothbury.nodeCount)).toBeGreaterThan(3);
    expect(progress?.hitCount).toBe(lothbury.nodeCount);
    expect(progress?.completedAt).toEqual(new Date("2026-09-08T07:00:00Z"));
    expect(progress?.completedActivityId).toBe(second?.id ?? "");
    expect(first?.status).toBe("matched");
  });

  test("matching everything again arrives at the same progress", async () => {
    const login = uniqueLogin();
    const { work, drain } = createStreetsPipeline(testbed);
    const gpx = parseGpx(gpxRun, { name: "upload", startAt: NOON });
    expect(await work.importGpx(login, gpx, "a".repeat(64))).toBe(true);
    expect(await work.importGpx(login, gpx, "a".repeat(64))).toBe(false);
    await drain();
    const before = await db.select().from(streetProgress).where(eq(streetProgress.login, login));

    await work.rematchAll(login);
    await drain();

    expect(before.length).toBeGreaterThan(0);
    expect(await db.select().from(streetProgress).where(eq(streetProgress.login, login))).toEqual(before);
  });
});
