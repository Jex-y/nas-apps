import type { BlobStore, JobDefinition, JobQueue, Notifier, RegisteredJob, Schedule } from "@apps/core";
import { defineJob, defineSchedule, insertJob, PermanentJobError } from "@apps/core";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { StreetsDb, StreetsTx } from "./db";
import { type Box, boxOf, LONDON } from "./geo";
import { matchTrack } from "./matching";
import { buildTile, finishTile, saveTile, tileBox, tileCells, tilesOver } from "./network";
import {
  boroughListQuery,
  boroughQuery,
  type Overpass,
  parseBoroughBoundary,
  parseBoroughList,
  parseWays,
  tileQuery,
} from "./overpass";
import { type Completion, recordHits } from "./progress";
import { activities, boroughs, connections, nodeHits, refreshes, streetProgress, streets } from "./schema";
import type { StravaActivity, StravaApi, StravaResult } from "./strava";
import { decodeTrack, encodeTrack, type ParsedGpx, type Track, trackKey } from "./track";

export type StreetsWorkDeps = {
  readonly db: StreetsDb;
  readonly blob: BlobStore;
  readonly queue: JobQueue;
  /** Reaches only the given login's devices. */
  readonly notifier: (login: string) => Notifier;
  /** `null` when no Strava application is configured; only uploaded GPX files are imported then. */
  readonly strava: StravaApi | null;
  readonly overpass: Overpass;
  readonly publicUrl: string;
  readonly now: () => Date;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Strava's largest page. */
export const BACKFILL_PAGE = 200;
const POLL_PAGE = 50;
/** Polls re-read a day before the newest known run, so one synced late (a watch the next morning) is still found. */
const POLL_OVERLAP_SECONDS = 24 * 60 * 60;
/** Access tokens last six hours; one this close to expiry is refreshed first, so none lapses mid-job. */
const TOKEN_MARGIN_MS = 5 * MINUTE;
/** OSM changes slowly; monthly keeps new streets coming without leaning on a free, shared service. */
export const NETWORK_MAX_AGE_MS = 30 * DAY;
/** A refresh still unfinished after this long is presumed stuck (a tile gave up) and a new one starts. */
const STUCK_REFRESH_MS = 2 * DAY;
/** Tile queries are spread out, so the import is a light, steady load on Overpass rather than a burst. */
export const TILE_SPACING_MS = 20_000;
/** Overpass can take minutes on a big query; still inside the job lease. */
const OVERPASS_TIMEOUT_MS = 4 * MINUTE;

export const RUN_TYPES = ["Run", "TrailRun"] as const;
export const WALK_TYPES = ["Walk", "Hike"] as const;

/** Runs always; walks and hikes when the athlete opts in. Virtual runs happen on a treadmill, not a street. */
export const isImported = (sportType: string, includeWalks: boolean): boolean =>
  (RUN_TYPES as readonly string[]).includes(sportType) ||
  (includeWalks && (WALK_TYPES as readonly string[]).includes(sportType));

/** Strava is polled in waking hours (London time) only; runs recorded overnight are picked up in the morning. */
export const isActiveHour = (at: Date): boolean => {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(at),
  );
  return hour >= 7 && hour < 23;
};

export const formatPercent = (part: number, whole: number): string => {
  const percent = whole === 0 ? 0 : (part / whole) * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.floor(percent)}%`;
};

type Failure = Exclude<StravaResult<unknown>, { kind: "ok" }> | { readonly kind: "disconnected" };

export const createStreetsWork = (deps: StreetsWorkDeps) => {
  const { db, blob, queue, overpass } = deps;

  /** Runs a job again once Strava's limit resets; with a fresh dedupe key, since this run still holds its own. */
  const later =
    <P>(job: JobDefinition<P>, payload: P, key: string) =>
    (retryAt: Date) =>
      queue.enqueue(job, payload, { runAt: retryAt, dedupeKey: `${key}@${retryAt.getTime()}` });

  /** What a Strava job does when a call fails: wait out a limit, or record that the athlete must reconnect. */
  const setBack = async (login: string, failure: Failure, retry: (at: Date) => Promise<unknown>) => {
    switch (failure.kind) {
      case "limited":
        await retry(failure.retryAt);
        return;
      case "unauthorized": {
        const message = "Strava no longer accepts this connection; connect again";
        await db.update(connections).set({ lastError: message }).where(eq(connections.login, login));
        throw new PermanentJobError(message);
      }
      case "gone":
      case "disconnected":
        return;
    }
  };

  /**
   * A current access token for the login, refreshed when about to expire. The row is locked meanwhile: Strava voids
   * a refresh token once it is used, so two jobs refreshing at once would leave one holding a dead token.
   */
  const accessToken = (login: string): Promise<StravaResult<string> | Failure> =>
    db.transaction(async (tx) => {
      const [connection] = await tx.select().from(connections).where(eq(connections.login, login)).for("update");
      if (connection === undefined || deps.strava === null) {
        return { kind: "disconnected" };
      }
      if (connection.expiresAt.getTime() - deps.now().getTime() > TOKEN_MARGIN_MS) {
        return { kind: "ok", body: connection.accessToken };
      }
      const refreshed = await deps.strava.refresh(connection.refreshToken);
      if (refreshed.kind !== "ok") {
        return refreshed;
      }
      await tx
        .update(connections)
        .set({ ...refreshed.body, lastError: null })
        .where(eq(connections.login, login));
      return { kind: "ok", body: refreshed.body.accessToken };
    });

  /** Strava's client, which exists whenever a job that calls it has been queued. */
  const stravaApi = (): StravaApi => {
    if (deps.strava === null) {
      throw new PermanentJobError("Strava is not configured");
    }
    return deps.strava;
  };

  /** Keeps the track for re-matching; the blob is written before the row points at it. */
  const storeTrack = async (activityId: string, track: Track) => {
    const key = trackKey(activityId);
    await blob.write(key, new Blob([encodeTrack(track)]), "application/gzip");
    await db
      .update(activities)
      .set({ trackKey: key, ...boxOf(track.latlng) })
      .where(eq(activities.id, activityId));
  };

  const announce = async (login: string, activityName: string, completed: readonly Completion[]) => {
    const streetIds = completed.map((completion) => completion.streetId);
    const [top] = await db
      .select({ boroughId: streets.boroughId, name: boroughs.name })
      .from(streets)
      .innerJoin(boroughs, eq(boroughs.id, streets.boroughId))
      .where(inArray(streets.id, streetIds))
      .groupBy(streets.boroughId, boroughs.name)
      .orderBy(desc(count()))
      .limit(1);
    if (top === undefined) {
      return;
    }
    const [borough] = await db
      .select({ total: count(), completed: count(streetProgress.completedAt) })
      .from(streets)
      .leftJoin(streetProgress, and(eq(streetProgress.streetId, streets.id), eq(streetProgress.login, login)))
      .where(eq(streets.boroughId, top.boroughId));
    const plural = streetIds.length === 1 ? "street" : "streets";
    await deps.notifier(login).send({
      title: activityName,
      message: `${streetIds.length} new ${plural} · ${top.name} now ${formatPercent(borough?.completed ?? 0, borough?.total ?? 0)}`,
      clickUrl: `${deps.publicUrl}/streets/`,
    });
  };

  const matchActivity = defineJob({
    name: "streets.match-activity",
    payload: z.object({ activityId: z.uuid(), notify: z.boolean() }),
    timeoutMs: 2 * MINUTE,
    handle: async ({ activityId, notify }) => {
      const [activity] = await db.select().from(activities).where(eq(activities.id, activityId));
      if (activity?.trackKey == null) {
        return;
      }
      const track = decodeTrack(await blob.read(activity.trackKey));
      const nodeIds = await matchTrack(db, track.latlng);
      const completed = await db.transaction(async (tx) => {
        const newlyCompleted = await recordHits(tx, {
          login: activity.login,
          activityId,
          hitAt: activity.startAt,
          nodeIds,
        });
        await tx
          .update(activities)
          .set({ status: "matched", matchedAt: deps.now() })
          .where(eq(activities.id, activityId));
        return newlyCompleted;
      });
      if (notify && completed.length > 0) {
        await announce(activity.login, activity.name, completed);
      }
    },
  });

  const fetchActivity = defineJob({
    name: "streets.fetch-activity",
    payload: z.object({ activityId: z.uuid(), notify: z.boolean() }),
    handle: async (payload): Promise<void> => {
      const [activity] = await db.select().from(activities).where(eq(activities.id, payload.activityId));
      if (activity === undefined || activity.source !== "strava" || activity.status !== "pending") {
        return;
      }
      const retry = later(fetchActivity, payload, activity.id);
      if (activity.trackKey === null) {
        const token = await accessToken(activity.login);
        if (token.kind !== "ok") {
          return setBack(activity.login, token, retry);
        }
        const result = await stravaApi().track(token.body, Number(activity.externalId));
        if (result.kind === "gone") {
          await db.delete(activities).where(eq(activities.id, activity.id));
          return;
        }
        if (result.kind !== "ok") {
          return setBack(activity.login, result, retry);
        }
        if (result.body === null) {
          await db.update(activities).set({ status: "no_track" }).where(eq(activities.id, activity.id));
          return;
        }
        await storeTrack(activity.id, result.body);
      }
      await queue.enqueue(matchActivity, payload, { dedupeKey: activity.id });
    },
  });

  /** Records runs Strava listed and queues their tracks; ones already known are left alone, so this is idempotent. */
  const addStravaActivities = async (
    login: string,
    includeWalks: boolean,
    listed: readonly StravaActivity[],
    notify: boolean,
  ) => {
    const wanted = listed.filter((activity) => !activity.manual && isImported(activity.sportType, includeWalks));
    if (wanted.length === 0) {
      return;
    }
    await db.transaction(async (tx) => {
      const added = await tx
        .insert(activities)
        .values(
          wanted.map((activity) => ({
            login,
            source: "strava" as const,
            externalId: String(activity.id),
            name: activity.name,
            sportType: activity.sportType,
            startAt: activity.startAt,
            distanceMetres: activity.distanceMetres,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: activities.id });
      for (const { id } of added) {
        await insertJob(tx, fetchActivity, { activityId: id, notify }, { dedupeKey: id });
      }
    });
  };

  const connectionOf = async (login: string) => {
    const [connection] = await db.select().from(connections).where(eq(connections.login, login));
    return connection;
  };

  const backfill = defineJob({
    name: "streets.backfill",
    payload: z.object({ login: z.string(), before: z.number().int().nullable() }),
    handle: async (payload): Promise<void> => {
      const { login, before } = payload;
      const connection = await connectionOf(login);
      if (connection === undefined) {
        return;
      }
      const retry = later(backfill, payload, `${login}:${before}`);
      const token = await accessToken(login);
      if (token.kind !== "ok") {
        return setBack(login, token, retry);
      }
      const page = await stravaApi().activities(token.body, {
        ...(before !== null && { before }),
        perPage: BACKFILL_PAGE,
      });
      if (page.kind !== "ok") {
        return setBack(login, page, retry);
      }
      await addStravaActivities(login, connection.includeWalks, page.body, false);
      if (page.body.length < BACKFILL_PAGE) {
        await db
          .update(connections)
          .set({ backfill: "done", backfillFinishedAt: deps.now() })
          .where(eq(connections.login, login));
      } else {
        const next = Math.floor(Math.min(...page.body.map((activity) => activity.startAt.getTime())) / 1000);
        await queue.enqueue(backfill, { login, before: next }, { dedupeKey: `${login}:${next}` });
      }
    },
  });

  const pollAthlete = defineJob({
    name: "streets.poll-athlete",
    payload: z.object({ login: z.string() }),
    maxAttempts: 2,
    handle: async ({ login }): Promise<void> => {
      const connection = await connectionOf(login);
      if (connection === undefined) {
        return;
      }
      const retry = later(pollAthlete, { login }, login);
      const token = await accessToken(login);
      if (token.kind !== "ok") {
        return setBack(login, token, retry);
      }
      const [newest] = await db
        .select({ startAt: max(activities.startAt) })
        .from(activities)
        .where(and(eq(activities.login, login), eq(activities.source, "strava")));
      const since = newest?.startAt ?? deps.now();
      const page = await stravaApi().activities(token.body, {
        after: Math.floor(since.getTime() / 1000) - POLL_OVERLAP_SECONDS,
        perPage: POLL_PAGE,
      });
      if (page.kind !== "ok") {
        return setBack(login, page, retry);
      }
      await addStravaActivities(login, connection.includeWalks, page.body, true);
      await db
        .update(connections)
        .set({ lastPolledAt: deps.now(), lastError: null })
        .where(eq(connections.login, login));
    },
  });

  const poll = defineJob({
    name: "streets.poll",
    payload: z.object({}),
    handle: async () => {
      if (deps.strava === null || !isActiveHour(deps.now())) {
        return;
      }
      for (const { login } of await db.select({ login: connections.login }).from(connections)) {
        await queue.enqueue(pollAthlete, { login }, { dedupeKey: login });
      }
    },
  });

  const importTile = defineJob({
    name: "streets.import-tile",
    payload: z.object({ refreshId: z.number().int(), row: z.number().int(), col: z.number().int() }),
    timeoutMs: OVERPASS_TIMEOUT_MS,
    handle: async ({ refreshId, row, col }, { signal, attempt }) => {
      const tile = { row, col };
      const box = tileBox(tile);
      const shapes = await db
        .select({
          id: boroughs.id,
          boundary: boroughs.boundary,
          south: boroughs.south,
          west: boroughs.west,
          north: boroughs.north,
          east: boroughs.east,
        })
        .from(boroughs)
        .where(
          and(
            eq(boroughs.generation, refreshId),
            isNotNull(boroughs.boundary),
            lte(boroughs.south, box.north),
            gte(boroughs.north, box.south),
            lte(boroughs.west, box.east),
            gte(boroughs.east, box.west),
          ),
        );
      const ways = parseWays(await overpass.query(tileQuery(box), signal, attempt));
      const content = buildTile(
        ways,
        shapes.map(({ id, boundary, south, west, north, east }) => ({
          id,
          boundary: boundary ?? [],
          box: { south: south ?? 0, west: west ?? 0, north: north ?? 0, east: east ?? 0 },
        })),
      );
      await db.transaction(async (tx) => {
        const added = await saveTile(tx, content, { generation: refreshId, cells: tileCells(tile) });
        if (added > 0) {
          await rematchWithin(tx, box);
        }
        await finishTile(tx, refreshId);
      });
    },
  });

  /** New nodes can only be credited by matching again the activities that pass near them. */
  const rematchWithin = async (tx: StreetsTx, box: Box) => {
    const nearby = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          isNotNull(activities.trackKey),
          lte(activities.south, box.north),
          gte(activities.north, box.south),
          lte(activities.west, box.east),
          gte(activities.east, box.west),
        ),
      );
    for (const { id } of nearby) {
      await insertJob(tx, matchActivity, { activityId: id, notify: false }, { dedupeKey: id });
    }
  };

  /** Queues every tile overlapping a borough, spaced out; once per refresh, however many jobs race to it. */
  const planTiles = async (tx: StreetsTx, refreshId: number) => {
    const shapes = await tx
      .select({ south: boroughs.south, west: boroughs.west, north: boroughs.north, east: boroughs.east })
      .from(boroughs)
      .where(eq(boroughs.generation, refreshId));
    const tiles = tilesOver(
      shapes.flatMap(({ south, west, north, east }) =>
        south === null || west === null || north === null || east === null ? [] : [{ south, west, north, east }],
      ),
    );
    const start = deps.now().getTime();
    for (const [index, { row, col }] of tiles.entries()) {
      await insertJob(
        tx,
        importTile,
        { refreshId, row, col },
        { dedupeKey: `${refreshId}:${row}:${col}`, runAt: new Date(start + index * TILE_SPACING_MS) },
      );
    }
    await tx.update(refreshes).set({ tiles: tiles.length }).where(eq(refreshes.id, refreshId));
  };

  const fetchBorough = defineJob({
    name: "streets.fetch-borough",
    payload: z.object({ refreshId: z.number().int(), boroughId: z.number().int() }),
    timeoutMs: OVERPASS_TIMEOUT_MS,
    handle: async ({ refreshId, boroughId }, { signal, attempt }) => {
      const boundary = parseBoroughBoundary(await overpass.query(boroughQuery(boroughId), signal, attempt), boroughId);
      const box = boxOf(boundary.flat());
      if (box === null) {
        throw new PermanentJobError(`Borough ${boroughId} has no boundary`);
      }
      await db.transaction(async (tx) => {
        // Serialises the borough jobs of one refresh, so exactly one sees the last boundary arrive.
        const [refresh] = await tx.select().from(refreshes).where(eq(refreshes.id, refreshId)).for("update");
        if (refresh === undefined) {
          return;
        }
        await tx
          .update(boroughs)
          .set({ boundary, ...box })
          .where(and(eq(boroughs.id, boroughId), eq(boroughs.generation, refreshId)));
        const [missing] = await tx
          .select({ count: count() })
          .from(boroughs)
          .where(and(eq(boroughs.generation, refreshId), isNull(boroughs.boundary)));
        if (missing?.count === 0 && refresh.tiles === 0) {
          await planTiles(tx, refreshId);
        }
      });
    },
  });

  const refreshNetwork = defineJob({
    name: "streets.refresh-network",
    payload: z.object({ force: z.boolean() }),
    timeoutMs: OVERPASS_TIMEOUT_MS,
    handle: async ({ force }, { signal, attempt }) => {
      const [latest] = await db.select().from(refreshes).orderBy(desc(refreshes.id)).limit(1);
      const age = (since: Date) => deps.now().getTime() - since.getTime();
      const fresh =
        latest !== undefined &&
        (latest.finishedAt === null
          ? age(latest.startedAt) < STUCK_REFRESH_MS
          : age(latest.finishedAt) < NETWORK_MAX_AGE_MS);
      if (fresh && !force) {
        return;
      }
      const listed = parseBoroughList(await overpass.query(boroughListQuery(LONDON), signal, attempt));
      if (listed.length === 0) {
        throw new Error("Overpass listed no London boroughs");
      }
      await db.transaction(async (tx) => {
        const [refresh] = await tx.insert(refreshes).values({}).returning({ id: refreshes.id });
        if (refresh === undefined) {
          throw new Error("INSERT … RETURNING produced no refresh");
        }
        await tx
          .insert(boroughs)
          .values(listed.map((borough) => ({ ...borough, generation: refresh.id })))
          .onConflictDoUpdate({
            target: boroughs.id,
            set: { name: sql`excluded.name`, generation: sql`excluded.generation`, boundary: null },
          });
        for (const borough of listed) {
          await insertJob(
            tx,
            fetchBorough,
            { refreshId: refresh.id, boroughId: borough.id },
            { dedupeKey: `${refresh.id}:${borough.id}` },
          );
        }
      });
    },
  });

  /** Clears a login's hits and matches all its activities again, e.g. after the matching rules change. */
  const rematchAll = defineJob({
    name: "streets.rematch-all",
    payload: z.object({ login: z.string() }),
    handle: async ({ login }) => {
      await db.transaction(async (tx) => {
        await tx.delete(nodeHits).where(eq(nodeHits.login, login));
        await tx.delete(streetProgress).where(eq(streetProgress.login, login));
        const tracked = await tx
          .select({ id: activities.id })
          .from(activities)
          .where(and(eq(activities.login, login), isNotNull(activities.trackKey)));
        for (const { id } of tracked) {
          await insertJob(tx, matchActivity, { activityId: id, notify: false }, { dedupeKey: id });
        }
      });
    },
  });

  const jobs: readonly RegisteredJob[] = [
    poll,
    pollAthlete,
    backfill,
    fetchActivity,
    matchActivity,
    refreshNetwork,
    fetchBorough,
    importTile,
    rematchAll,
  ];

  const schedules: readonly Schedule[] = [
    defineSchedule({ name: "streets.poll", everyMs: 30 * MINUTE, jitterMs: 5 * MINUTE, job: poll, payload: {} }),
    defineSchedule({
      name: "streets.refresh-network",
      everyMs: DAY,
      jitterMs: 2 * HOUR,
      job: refreshNetwork,
      payload: { force: false },
    }),
  ];

  return {
    jobs,
    schedules,
    definitions: {
      poll,
      pollAthlete,
      backfill,
      fetchActivity,
      matchActivity,
      refreshNetwork,
      fetchBorough,
      importTile,
      rematchAll,
    },
    /** Pages through the athlete's whole history, newest first. */
    startBackfill: (login: string) => queue.enqueue(backfill, { login, before: null }, { dedupeKey: `${login}:null` }),
    /** Imports the street network from OpenStreetMap now, however recent the last import. */
    refreshNetwork: () => queue.enqueue(refreshNetwork, { force: true }, { dedupeKey: "force" }),
    rematchAll: (login: string) => queue.enqueue(rematchAll, { login }, { dedupeKey: login }),
    /**
     * Imports an uploaded GPX file, identified by its content hash; resolves `false` when that file was already
     * imported. Its track is stored before the row that points at it, as for Strava's.
     */
    importGpx: async (login: string, gpx: ParsedGpx, sha256: string): Promise<boolean> => {
      const known = await db
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.login, login), eq(activities.source, "gpx"), eq(activities.externalId, sha256)));
      if (known.length > 0) {
        return false;
      }
      const id = Bun.randomUUIDv7();
      const key = trackKey(id);
      await blob.write(key, new Blob([encodeTrack(gpx.track)]), "application/gzip");
      const [added] = await db
        .insert(activities)
        .values({
          id,
          login,
          source: "gpx",
          externalId: sha256,
          name: gpx.name,
          sportType: gpx.sportType,
          startAt: gpx.startAt,
          distanceMetres: gpx.distanceMetres,
          trackKey: key,
          ...boxOf(gpx.track.latlng),
        })
        .onConflictDoNothing()
        .returning({ id: activities.id });
      if (added === undefined) {
        await blob.delete(key);
        return false;
      }
      await queue.enqueue(matchActivity, { activityId: id, notify: false }, { dedupeKey: id });
      return true;
    },
  };
};

export type StreetsWork = ReturnType<typeof createStreetsWork>;
