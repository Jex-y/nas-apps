import { beforeAll, beforeEach } from "bun:test";
import { type AppContext, createBlobStore, drainJobs, type Notification } from "@apps/core";
import { createTestContext } from "@apps/core/testing";
import { eq } from "drizzle-orm";
import { streetsDb } from "../src/api/db";
import { type Overpass, parseWays } from "../src/api/overpass";
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

export const gpxRun = await fixture("gpx/strava-export.gpx").text();

export const CITY_OF_LONDON = 51800;

/** Bank junction, in the middle of `bankWays`. */
export const BANK = [51.5134, -0.0889] as const;

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

/** A track through every vertex of the named streets in `bankWays`, a fix every five seconds. */
export const along = (...names: string[]): Track => {
  const latlng = parseWays(bankWays)
    .filter((way) => names.includes(way.name))
    .flatMap((way) => way.geometry);
  if (latlng.length === 0) {
    throw new Error(`No recorded ways named ${names.join(", ")}`);
  }
  return { latlng, time: latlng.map((_, index) => index * 5) };
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

/** Strava as one athlete sees it, whose only valid authorisation code is `good-code`. */
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

/** Puts a run in the athlete's history, along the named streets, or with no GPS when there are none. */
export const record = (
  strava: FakeStrava,
  id: number,
  startAt: string,
  streetNames: readonly string[],
  overrides: Partial<StravaActivity> = {},
) => {
  strava.history.push({
    id,
    name: `Run ${id}`,
    sportType: "Run",
    startAt: new Date(startAt),
    distanceMetres: 1_000,
    manual: false,
    ...overrides,
  });
  strava.history.sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  if (streetNames.length > 0) {
    strava.tracks.set(id, along(...streetNames));
  }
};

/** Noon on a past British Summer Time weekday: inside polling hours, and already due by the database clock. */
export const NOON = new Date("2026-09-21T11:00:00Z");

/**
 * The real test database with the recorded street network imported once per test file. Each test starts with no
 * runs, connections, progress or streets jobs. Call once per test file: it owns that file's connection.
 */
export const createStreetsTestContext = () => {
  const context: AppContext = createTestContext();
  const db = streetsDb(context.sql);

  /** Imports the recorded ways around Bank, as the monthly refresh would. */
  const importNetwork = async (ways: unknown = bankWays) => {
    const work = createStreetsWork({
      db,
      blob: createBlobStore(context.blob, "streets"),
      queue: context.jobs,
      notifier: () => ({ send: async () => {} }),
      strava: null,
      overpass: fakeOverpass(ways),
      publicUrl: context.publicUrl,
      now: () => NOON,
    });
    await work.refreshNetwork();
    return drainJobs(context.sql, work.jobs);
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
    await context.sql`truncate streets.boroughs, streets.refreshes cascade`;
    await context.sql`delete from jobs.jobs where name like 'streets.%'`;
    await importNetwork();
  });

  beforeEach(async () => {
    await context.sql`truncate streets.activities, streets.connections, streets.node_hits, streets.street_progress cascade`;
    await context.sql`delete from jobs.jobs where name like 'streets.%'`;
  });

  return { context, db, importNetwork, connect, streetNamed };
};

/** A streets pipeline over the test context, with Strava and Overpass replaced by fakes and notifications by a list. */
export const createStreetsPipeline = (
  { context, db }: Pick<ReturnType<typeof createStreetsTestContext>, "context" | "db">,
  { now = () => NOON, overpass = fakeOverpass() }: { now?: () => Date; overpass?: Overpass } = {},
) => {
  const sent: (Notification & { readonly login: string })[] = [];
  const strava = fakeStrava(now);
  const work = createStreetsWork({
    db,
    blob: createBlobStore(context.blob, "streets"),
    queue: context.jobs,
    notifier: (login) => ({ send: async (notification) => void sent.push({ login, ...notification }) }),
    strava,
    overpass,
    publicUrl: "https://apps.example",
    now,
  });
  return { work, sent, strava, drain: (at?: Date) => drainJobs(context.sql, work.jobs, at) };
};
