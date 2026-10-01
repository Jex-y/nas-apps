import { beforeAll, beforeEach } from "bun:test";
import { type AppContext, createBlobStore, drainJobs, type Notification } from "@nas/core";
import { createTestContext } from "@nas/core/testing";
import { eq } from "drizzle-orm";
import { streetsDb } from "../src/api/db";
import type { LatLon } from "../src/api/geo";
import type { Overpass } from "../src/api/overpass";
import { connections, streets } from "../src/api/schema";
import type { StravaActivity, StravaApi, StravaGrant, StravaResult, StravaTokens } from "../src/api/strava";
import type { Track } from "../src/api/track";
import { createStreetsWork } from "../src/api/work";

const fixture = (path: string) => Bun.file(new URL(`./fixtures/${path}`, import.meta.url));

/** Recorded from Overpass: London's borough list (trimmed), the City of London's boundary, and ways around Bank. */
export const [boroughList, cityBoundary, bankWays] = await Promise.all([
  fixture("overpass/borough-list.json").json(),
  fixture("overpass/city-of-london.json").json(),
  fixture("overpass/bank-ways.json").json(),
]);

/** Runs along streets in `bankWays`, as Strava's streams endpoint returns them. */
export const streams: Readonly<Record<string, unknown>> = await fixture("strava/streams.json").json();

export const gpxRun = await fixture("gpx/strava-export.gpx").text();

export const CITY_OF_LONDON = 51800;

/** Answers each kind of query from the fixtures, recording what it was asked. */
export const fakeOverpass = (ways: unknown = bankWays): Overpass & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    query: async (ql) => {
      asked.push(ql);
      if (ql.includes("out tags")) {
        return boroughList;
      }
      if (ql.includes(`rel(${CITY_OF_LONDON})`)) {
        return cityBoundary;
      }
      if (ql.includes("way(")) {
        return ways;
      }
      throw new Error(`Unexpected Overpass query ${ql}`);
    },
  };
};

const trackFrom = (body: unknown): Track => {
  const { latlng, time } = body as { latlng: { data: LatLon[] }; time: { data: number[] } };
  return { latlng: latlng.data, time: time.data };
};

export type FakeStrava = StravaApi & {
  /** The athlete's history, newest first. */
  readonly history: StravaActivity[];
  /** Tracks by activity id; missing ones have no GPS. */
  readonly tracks: Map<number, Track>;
  readonly calls: string[];
  /** While set, every API call is refused as over the rate limit. */
  limitedUntil: Date | null;
  /** Set to refuse the refresh token, as after the athlete revokes access. */
  revoked: boolean;
};

export const ATHLETE = { id: 424_242, name: "Ed Runner" } as const;

export const fakeStrava = (now: () => Date): FakeStrava => {
  let issued = 0;
  const tokens = (): StravaTokens => {
    issued += 1;
    return {
      accessToken: `access-${issued}`,
      refreshToken: `refresh-${issued}`,
      expiresAt: new Date(now().getTime() + 6 * 3_600_000),
    };
  };
  const limited = <T>(call: () => T): StravaResult<T> =>
    strava.limitedUntil !== null && strava.limitedUntil > now()
      ? { kind: "limited", retryAt: strava.limitedUntil }
      : { kind: "ok", body: call() };

  const strava: FakeStrava = {
    history: [],
    tracks: new Map(),
    calls: [],
    limitedUntil: null,
    revoked: false,
    authorizeUrl: (redirectUri, state) =>
      `https://strava.test/oauth/authorize?${new URLSearchParams({ redirect_uri: redirectUri, state })}`,
    exchangeCode: async (code): Promise<StravaGrant> => {
      strava.calls.push(`exchange ${code}`);
      if (code !== "good-code") {
        throw new Error("Bad code");
      }
      return { ...tokens(), athlete: ATHLETE };
    },
    refresh: async (refreshToken) => {
      strava.calls.push(`refresh ${refreshToken}`);
      return strava.revoked ? { kind: "unauthorized" } : { kind: "ok", body: tokens() };
    },
    deauthorize: async (accessToken) => {
      strava.calls.push(`deauthorize ${accessToken}`);
    },
    activities: async (accessToken, { before, after, perPage }) => {
      strava.calls.push(`activities ${accessToken} before=${before} after=${after}`);
      return limited(() => {
        const inRange = strava.history.filter(
          (activity) =>
            (before === undefined || activity.startAt.getTime() / 1000 < before) &&
            (after === undefined || activity.startAt.getTime() / 1000 > after),
        );
        return (after === undefined ? inRange : inRange.toReversed()).slice(0, perPage);
      });
    },
    track: async (accessToken, activityId) => {
      strava.calls.push(`track ${accessToken} ${activityId}`);
      return limited(() => strava.tracks.get(activityId) ?? null);
    },
  };
  return strava;
};

export const run = (id: number, startAt: string, streamName: string | null, overrides: Partial<StravaActivity> = {}) => ({
  activity: {
    id,
    name: `Run ${id}`,
    sportType: "Run",
    startAt: new Date(startAt),
    distanceMetres: 1_000,
    manual: false,
    ...overrides,
  },
  track: streamName === null ? null : trackFrom(streams[streamName]),
});

/** Noon on a past British Summer Time weekday: inside polling hours, and already due by the database clock. */
export const NOON = new Date("2026-09-21T11:00:00Z");

/**
 * A streets pipeline over the real test database and blob store, with Strava and Overpass replaced by fakes and
 * notifications by a list. Call once per test file: it owns that file's connection. The recorded street network is
 * imported once; each test starts with no runs, connections or streets jobs.
 */
export const createStreetsTestbed = () => {
  const context: AppContext = createTestContext();
  const db = streetsDb(context.sql);
  const blob = createBlobStore(context.blob, `streets-test/${crypto.randomUUID()}`);

  const setup = ({ now = NOON, overpass = fakeOverpass() }: { now?: Date; overpass?: Overpass } = {}) => {
    const sent: Notification[] = [];
    const strava = fakeStrava(() => now);
    const work = createStreetsWork({
      db,
      blob,
      queue: context.jobs,
      notifier: { send: async (notification) => void sent.push(notification) },
      strava,
      overpass,
      publicUrl: "https://apps.example",
      now: () => now,
    });
    return { work, sent, strava, drain: (at?: Date) => drainJobs(context.sql, work.jobs, at) };
  };

  const resetNetwork = async () => {
    await context.sql`truncate streets.boroughs, streets.refreshes cascade`;
  };

  /** Imports the recorded ways around Bank, as the monthly refresh would. */
  const importNetwork = async (ways: unknown = bankWays) => {
    const { work, drain } = setup({ overpass: fakeOverpass(ways) });
    await work.refreshNetwork();
    return drain();
  };

  const connect = async (login: string, expiresAt = new Date(NOON.getTime() + 3_600_000)) => {
    await db.insert(connections).values({
      login,
      athleteId: ATHLETE.id,
      athleteName: ATHLETE.name,
      accessToken: "access-0",
      refreshToken: "refresh-0",
      expiresAt,
      scope: "read,activity:read_all",
    });
  };

  const streetNamed = async (name: string) => {
    const [street] = await db.select().from(streets).where(eq(streets.name, name));
    if (street === undefined) {
      throw new Error(`No street ${name}`);
    }
    return street;
  };

  beforeAll(async () => {
    await resetNetwork();
    await importNetwork();
  });

  beforeEach(async () => {
    await context.sql`truncate streets.activities, streets.connections, streets.node_hits, streets.street_progress cascade`;
    await context.sql`delete from jobs.jobs where name like 'streets.%'`;
  });

  return { context, db, blob, setup, importNetwork, resetNetwork, connect, streetNamed };
};
