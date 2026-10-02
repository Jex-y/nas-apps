import { and, asc, count, desc, eq, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type {
  Activity,
  MapStreet,
  NearbyStreet,
  NetworkStatus,
  Stats,
  StravaStatus,
  StreetNode,
  StreetState,
  Suggestion,
} from "../contract";
import type { StreetsDb } from "./db";
import { boxAround, CELLS, createGrid, haversineMetres, type LatLon, MAP_TILES } from "./geo";
import { chunks } from "./progress";
import {
  activities,
  boroughs,
  connections,
  nodeHits,
  nodes,
  refreshes,
  segments,
  streetProgress,
  streets,
} from "./schema";

/** Weeks in the stats timeline, which also bounds the streak it can show. */
const TIMELINE_WEEKS = 52;
const RECENT_STREETS = 20;
/** Suggestions look this far from the start point; about a 30–40 minute run out and back. */
const SUGGESTION_RADIUS_METRES = 3_000;
/** Unfinished streets are grouped into clusters on this grid: an area worth a detour on its own. */
const CLUSTERS = createGrid(500);
const SUGGESTIONS = 5;
const STREETS_PER_SUGGESTION = 8;

const iso = (date: Date | null) => date?.toISOString() ?? null;

const stateOf = (completedAt: Date | null, hitCount: number): StreetState =>
  completedAt !== null ? "complete" : hitCount > 0 ? "partial" : "untouched";

/** Consecutive weeks with a new street, ending this week, or last week while this one has none yet. */
export const streak = (weeks: readonly number[]): number => {
  const ended = weeks.at(-1) === 0 ? weeks.slice(0, -1) : weeks;
  return ended.length - 1 - ended.lastIndexOf(0);
};

export type Candidate = {
  readonly id: number;
  readonly name: string;
  readonly centre: LatLon;
  readonly remaining: number;
};

/**
 * Groups unfinished streets near the start into ~500 m clusters and ranks them by streets per kilometre of travel,
 * so a dense patch of new streets a little further away beats a lone one next door.
 */
export const suggest = (start: LatLon, candidates: readonly Candidate[]): Suggestion[] =>
  [...Map.groupBy(candidates, (candidate) => CLUSTERS.cellOf(candidate.centre)).values()]
    .map((cluster) => {
      const lat = cluster.reduce((total, street) => total + street.centre[0], 0) / cluster.length;
      const lon = cluster.reduce((total, street) => total + street.centre[1], 0) / cluster.length;
      const distanceMetres = Math.round(haversineMetres(start, [lat, lon]));
      return {
        suggestion: {
          lat,
          lon,
          distanceMetres,
          streets: cluster
            .toSorted((a, b) => b.remaining - a.remaining)
            .slice(0, STREETS_PER_SUGGESTION)
            .map(({ id, name, remaining }) => ({ id, name, remainingNodes: remaining })),
        },
        score: cluster.length / (0.5 + distanceMetres / 1000),
      };
    })
    .toSorted((a, b) => b.score - a.score)
    .slice(0, SUGGESTIONS)
    .map(({ suggestion }) => suggestion);

export const readStravaStatus = async (db: StreetsDb, login: string, configured: boolean): Promise<StravaStatus> => {
  const [connection] = await db.select().from(connections).where(eq(connections.login, login));
  const byStatus = await db
    .select({ status: activities.status, count: count() })
    .from(activities)
    .where(eq(activities.login, login))
    .groupBy(activities.status);
  return {
    configured,
    connection:
      connection === undefined
        ? null
        : {
            athleteName: connection.athleteName,
            includeWalks: connection.includeWalks,
            includeRides: connection.includeRides,
            backfill: connection.backfill,
            backfillFinishedAt: iso(connection.backfillFinishedAt),
            lastPolledAt: iso(connection.lastPolledAt),
            lastError: connection.lastError,
          },
    activities: {
      pending: 0,
      matched: 0,
      no_track: 0,
      ...Object.fromEntries(byStatus.map((row) => [row.status, row.count])),
    },
  };
};

/** The segments of one {@link MAP_TILES} tile, by street; a street crossing tiles has its other pieces in those. */
export const readMapTile = async (db: StreetsDb, login: string, tile: number): Promise<MapStreet[]> => {
  const rows = await db
    .select({
      id: streets.id,
      name: streets.name,
      nodeCount: streets.nodeCount,
      hitCount: streetProgress.hitCount,
      completedAt: streetProgress.completedAt,
      path: segments.path,
    })
    .from(segments)
    .innerJoin(streets, eq(streets.id, segments.streetId))
    .leftJoin(streetProgress, and(eq(streetProgress.streetId, streets.id), eq(streetProgress.login, login)))
    .where(inArray(segments.cell, MAP_TILES.cellsOf(tile)));
  return [...Map.groupBy(rows, (row) => row.id).values()].map((pieces) => {
    const [first] = pieces as [(typeof pieces)[number]];
    const hitCount = first.hitCount ?? 0;
    return {
      id: first.id,
      name: first.name,
      state: stateOf(first.completedAt, hitCount),
      hitCount,
      nodeCount: first.nodeCount,
      paths: pieces.map((piece) => piece.path),
    };
  });
};

export const readStats = async (db: StreetsDb, login: string, now: Date): Promise<Stats> => {
  const perBorough = await db
    .select({
      id: boroughs.id,
      name: boroughs.name,
      streets: count(streets.id),
      completed: count(streetProgress.completedAt),
    })
    .from(boroughs)
    .innerJoin(streets, eq(streets.boroughId, boroughs.id))
    .leftJoin(streetProgress, and(eq(streetProgress.streetId, streets.id), eq(streetProgress.login, login)))
    .groupBy(boroughs.id, boroughs.name)
    .orderBy(asc(boroughs.name));
  const [network] = await db.select({ nodes: sum(streets.nodeCount).mapWith(Number) }).from(streets);
  const [hit] = await db.select({ nodes: count() }).from(nodeHits).where(eq(nodeHits.login, login));
  const recent = await db
    .select({
      id: streets.id,
      name: streets.name,
      borough: boroughs.name,
      completedAt: streetProgress.completedAt,
      activityName: activities.name,
    })
    .from(streetProgress)
    .innerJoin(streets, eq(streets.id, streetProgress.streetId))
    .innerJoin(boroughs, eq(boroughs.id, streets.boroughId))
    .leftJoin(activities, eq(activities.id, streetProgress.completedActivityId))
    .where(and(eq(streetProgress.login, login), isNotNull(streetProgress.completedAt)))
    .orderBy(desc(streetProgress.completedAt))
    .limit(RECENT_STREETS);
  const weeks = z.array(z.object({ week: z.string(), streets: z.number() })).parse(
    await db.execute(sql`
      with bounds as (select date_trunc('week', ${now}::timestamptz at time zone 'Europe/London') as this_week)
      select to_char(w.week, 'YYYY-MM-DD') as week, count(p.completed_at)::int as streets
      from bounds, generate_series(
        bounds.this_week - ${TIMELINE_WEEKS - 1} * interval '1 week', bounds.this_week, interval '1 week'
      ) as w(week)
      left join streets.street_progress p
        on p.login = ${login} and date_trunc('week', p.completed_at at time zone 'Europe/London') = w.week
      group by w.week
      order by w.week
    `),
  );

  return {
    overall: {
      streets: perBorough.reduce((total, borough) => total + borough.streets, 0),
      completed: perBorough.reduce((total, borough) => total + borough.completed, 0),
      nodes: network?.nodes ?? 0,
      nodesHit: hit?.nodes ?? 0,
    },
    boroughs: perBorough,
    recent: recent.flatMap(({ completedAt, ...street }) =>
      completedAt === null ? [] : [{ ...street, completedAt: completedAt.toISOString() }],
    ),
    weeks,
    streakWeeks: streak(weeks.map((week) => week.streets)),
  };
};

/** Streets whose centre is within `radiusMetres` of `centre`, nearest first, with the login's progress on each. */
export const readStreetsNear = async (
  db: StreetsDb,
  login: string,
  centre: LatLon,
  radiusMetres: number,
): Promise<NearbyStreet[]> => {
  const near: NearbyStreet[] = [];
  for (const cells of chunks(CELLS.cellsIn(boxAround(centre, radiusMetres)))) {
    const rows = await db
      .select({
        id: streets.id,
        name: streets.name,
        borough: boroughs.name,
        lat: streets.centerLat,
        lon: streets.centerLon,
        nodeCount: streets.nodeCount,
        hitCount: streetProgress.hitCount,
        completedAt: streetProgress.completedAt,
      })
      .from(streets)
      .innerJoin(boroughs, eq(boroughs.id, streets.boroughId))
      .leftJoin(streetProgress, and(eq(streetProgress.streetId, streets.id), eq(streetProgress.login, login)))
      .where(inArray(streets.cell, cells));
    for (const { lat, lon, completedAt, ...street } of rows) {
      if (lat === null || lon === null) {
        continue;
      }
      const distanceMetres = Math.round(haversineMetres(centre, [lat, lon]));
      const hitCount = street.hitCount ?? 0;
      if (distanceMetres <= radiusMetres) {
        near.push({ ...street, lat, lon, distanceMetres, hitCount, state: stateOf(completedAt, hitCount) });
      }
    }
  }
  return near.toSorted((a, b) => a.distanceMetres - b.distanceMetres);
};

export const readSuggestions = async (db: StreetsDb, login: string, start: LatLon): Promise<Suggestion[]> =>
  suggest(
    start,
    (await readStreetsNear(db, login, start, SUGGESTION_RADIUS_METRES))
      .filter((street) => street.state !== "complete")
      .map(({ id, name, lat, lon, nodeCount, hitCount }) => ({
        id,
        name,
        centre: [lat, lon],
        remaining: nodeCount - hitCount,
      })),
  );

export const readActivities = async (db: StreetsDb, login: string, limit: number): Promise<Activity[]> => {
  const rows = await db
    .select({
      id: activities.id,
      source: activities.source,
      name: activities.name,
      sportType: activities.sportType,
      startAt: activities.startAt,
      distanceMetres: activities.distanceMetres,
      status: activities.status,
      newStreets: count(streetProgress.completedAt),
    })
    .from(activities)
    .leftJoin(streetProgress, eq(streetProgress.completedActivityId, activities.id))
    .where(eq(activities.login, login))
    .groupBy(activities.id)
    .orderBy(desc(activities.startAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, startAt: row.startAt.toISOString() }));
};

export const readNetworkStatus = async (db: StreetsDb): Promise<NetworkStatus> => {
  const [network] = await db.select({ streets: count(), nodes: sum(streets.nodeCount).mapWith(Number) }).from(streets);
  const [known] = await db.select({ boroughs: count() }).from(boroughs);
  const [refresh] = await db.select().from(refreshes).orderBy(desc(refreshes.id)).limit(1);
  return {
    boroughs: known?.boroughs ?? 0,
    streets: network?.streets ?? 0,
    nodes: network?.nodes ?? 0,
    refresh:
      refresh === undefined
        ? null
        : {
            startedAt: refresh.startedAt.toISOString(),
            finishedAt: iso(refresh.finishedAt),
            tiles: refresh.tiles,
            tilesDone: refresh.tilesDone,
          },
  };
};

export const readStreetNodes = (db: StreetsDb, login: string, streetId: number): Promise<StreetNode[]> =>
  db
    .select({ lat: nodes.lat, lon: nodes.lon, hit: sql<boolean>`${nodeHits.nodeId} is not null` })
    .from(nodes)
    .leftJoin(nodeHits, and(eq(nodeHits.nodeId, nodes.id), eq(nodeHits.login, login)))
    .where(eq(nodes.streetId, streetId));
