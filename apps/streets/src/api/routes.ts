import { defineRoutes, HttpError, type IdentityMode, parseBody, parseParam, resolveViewer } from "@nas/core";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import {
  type Activity,
  type MapStreet,
  MAX_MAP_SPAN,
  MAX_UPLOAD_BYTES,
  type NetworkStatus,
  type Stats,
  type StravaStatus,
  type StreetNode,
  type StreetState,
  type Suggestion,
  UpdateStrava,
  type UploadResult,
} from "../contract";
import type { StreetsDb } from "./db";
import { type Box, boxAround, CELLS, contains, createGrid, haversineMetres, type LatLon, LONDON } from "./geo";
import type { OAuthStates } from "./oauth-state";
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
import type { StravaApi } from "./strava";
import { GpxError, parseGpx } from "./track";
import type { StreetsWork } from "./work";

export type StreetsRoutesDeps = {
  readonly db: StreetsDb;
  readonly identity: IdentityMode;
  readonly work: StreetsWork;
  readonly strava: StravaApi | null;
  readonly states: OAuthStates;
  readonly publicUrl: string;
  readonly now: () => Date;
};

/** Weeks in the stats timeline, which also bounds the streak it can show. */
const TIMELINE_WEEKS = 52;
const RECENT_STREETS = 20;
const ACTIVITY_LIMIT = 300;
/** Suggestions look this far from the start point; about a 30–40 minute run out and back. */
const SUGGESTION_RADIUS_METRES = 3_000;
/** Unfinished streets are grouped into clusters on this grid: an area worth a detour on its own. */
const CLUSTERS = createGrid(500);
const SUGGESTIONS = 5;
const STREETS_PER_SUGGESTION = 8;

const iso = (date: Date | null) => date?.toISOString() ?? null;
const redirectTo = (location: string) => new Response(null, { status: 302, headers: { Location: location } });

const Coordinate = (limit: number) => z.coerce.number().min(-limit).max(limit);

const Viewport = z
  .object({ south: Coordinate(90), west: Coordinate(180), north: Coordinate(90), east: Coordinate(180) })
  .refine((box) => box.north > box.south && box.east > box.west, { message: "The box is inside out" });

const Start = z.object({ lat: Coordinate(90), lon: Coordinate(180) });

const parseQuery = <S extends z.ZodType>(request: Request, schema: S): z.infer<S> => {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) {
    throw new HttpError(400, z.prettifyError(result.error));
  }
  return result.data;
};

/** Consecutive weeks with a new street, ending this week, or last week while this one has none yet. */
export const streak = (weeks: readonly number[]): number => {
  const ended = weeks.at(-1) === 0 ? weeks.slice(0, -1) : weeks;
  const lastEmpty = ended.findLastIndex((streets) => streets === 0);
  return ended.length - 1 - lastEmpty;
};

type Candidate = { readonly id: number; readonly name: string; readonly centre: LatLon; readonly remaining: number };

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

const Upload = z.instanceof(File);

const stateOf = (completedAt: Date | null, hitCount: number): StreetState =>
  completedAt !== null ? "complete" : hitCount > 0 ? "partial" : "untouched";

export const createStreetsRoutes = ({ db, identity, work, strava, states, publicUrl, now }: StreetsRoutesDeps) => {
  const requireStrava = (): StravaApi => {
    if (strava === null) {
      throw new HttpError(503, "Strava is not configured on this server");
    }
    return strava;
  };

  const redirectUri = `${publicUrl}/streets/api/strava/callback`;

  const stravaStatus = async (login: string): Promise<StravaStatus> => {
    const [connection] = await db.select().from(connections).where(eq(connections.login, login));
    const byStatus = await db
      .select({ status: activities.status, count: count() })
      .from(activities)
      .where(eq(activities.login, login))
      .groupBy(activities.status);
    return {
      configured: strava !== null,
      connection:
        connection === undefined
          ? null
          : {
              athleteName: connection.athleteName,
              includeWalks: connection.includeWalks,
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

  const restartBackfill = async (login: string) => {
    await db
      .update(connections)
      .set({ backfill: "running", backfillFinishedAt: null })
      .where(eq(connections.login, login));
    await work.startBackfill(login);
  };

  const mapStreets = async (login: string, box: Box): Promise<MapStreet[]> => {
    const rows = [];
    for (const cells of chunks(CELLS.cellsIn(box, 1))) {
      rows.push(
        ...(await db
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
          .where(inArray(segments.cell, cells))),
      );
    }
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

  const stats = async (login: string): Promise<Stats> => {
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
        with bounds as (select date_trunc('week', ${now()}::timestamptz at time zone 'Europe/London') as this_week)
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

  const suggestions = async (login: string, start: LatLon): Promise<Suggestion[]> => {
    const candidates: Candidate[] = [];
    for (const cells of chunks(CELLS.cellsIn(boxAround(start, SUGGESTION_RADIUS_METRES)))) {
      const rows = await db
        .select({
          id: streets.id,
          name: streets.name,
          lat: streets.centerLat,
          lon: streets.centerLon,
          nodeCount: streets.nodeCount,
          hitCount: streetProgress.hitCount,
        })
        .from(streets)
        .leftJoin(streetProgress, and(eq(streetProgress.streetId, streets.id), eq(streetProgress.login, login)))
        .where(and(inArray(streets.cell, cells), isNull(streetProgress.completedAt)));
      for (const { id, name, lat, lon, nodeCount, hitCount } of rows) {
        if (lat !== null && lon !== null && haversineMetres(start, [lat, lon]) <= SUGGESTION_RADIUS_METRES) {
          candidates.push({ id, name, centre: [lat, lon], remaining: nodeCount - (hitCount ?? 0) });
        }
      }
    }
    return suggest(start, candidates);
  };

  const activityList = async (login: string): Promise<Activity[]> => {
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
      .limit(ACTIVITY_LIMIT);
    return rows.map((row) => ({ ...row, startAt: row.startAt.toISOString() }));
  };

  const networkStatus = async (): Promise<NetworkStatus> => {
    const [network] = await db
      .select({ streets: count(), nodes: sum(streets.nodeCount).mapWith(Number) })
      .from(streets);
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

  const importUpload = async (login: string, file: File): Promise<boolean> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const xml = new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? Bun.gunzipSync(bytes) : bytes);
    const gpx = parseGpx(xml, {
      name: file.name.replace(/\.gpx(\.gz)?$/i, "") || "Uploaded run",
      startAt: new Date(file.lastModified || now().getTime()),
    });
    return work.importGpx(login, gpx, new Bun.CryptoHasher("sha256").update(xml).digest("hex"));
  };

  return defineRoutes({
    "/streets/api/strava": {
      GET: async (request) => Response.json(await stravaStatus(resolveViewer(identity, request).login)),
      PATCH: async (request) => {
        const { login } = resolveViewer(identity, request);
        const { includeWalks } = await parseBody(request, UpdateStrava);
        const [updated] = await db
          .update(connections)
          .set({ includeWalks })
          .where(eq(connections.login, login))
          .returning({ login: connections.login });
        if (updated === undefined) {
          throw new HttpError(404, "Strava is not connected");
        }
        if (includeWalks) {
          await restartBackfill(login);
        }
        return Response.json(await stravaStatus(login));
      },
      DELETE: async (request) => {
        const { login } = resolveViewer(identity, request);
        const [removed] = await db.delete(connections).where(eq(connections.login, login)).returning();
        if (removed === undefined) {
          throw new HttpError(404, "Strava is not connected");
        }
        await strava?.deauthorize(removed.accessToken).catch((error: unknown) => {
          console.error("Strava deauthorisation failed", error);
        });
        return new Response(null, { status: 204 });
      },
    },
    "/streets/api/strava/connect": {
      GET: (request) => {
        const { login } = resolveViewer(identity, request);
        return redirectTo(requireStrava().authorizeUrl(redirectUri, states.issue(login, now())));
      },
    },
    "/streets/api/strava/callback": {
      GET: async (request) => {
        const { login } = resolveViewer(identity, request);
        const api = requireStrava();
        const params = new URL(request.url).searchParams;
        if (!states.verify(params.get("state") ?? "", login, now())) {
          throw new HttpError(400, "This Strava authorisation expired or was not started here; connect again");
        }
        if (params.get("error") !== null) {
          return redirectTo("/streets/connect?strava=denied");
        }
        const scopes = (params.get("scope") ?? "").split(",");
        if (!scopes.includes("activity:read") && !scopes.includes("activity:read_all")) {
          return redirectTo("/streets/connect?strava=scope");
        }
        const code = params.get("code");
        if (!code) {
          throw new HttpError(400, "Strava sent no authorisation code");
        }
        const grant = await api.exchangeCode(code);
        const [taken] = await db
          .select({ login: connections.login })
          .from(connections)
          .where(eq(connections.athleteId, grant.athlete.id));
        if (taken !== undefined && taken.login !== login) {
          throw new HttpError(409, "That Strava account is already connected to another login");
        }
        const connection = {
          athleteId: grant.athlete.id,
          athleteName: grant.athlete.name,
          accessToken: grant.accessToken,
          refreshToken: grant.refreshToken,
          expiresAt: grant.expiresAt,
          scope: scopes.join(","),
          backfill: "running" as const,
          backfillFinishedAt: null,
          lastError: null,
        };
        await db
          .insert(connections)
          .values({ login, ...connection })
          .onConflictDoUpdate({ target: connections.login, set: connection });
        await work.startBackfill(login);
        return redirectTo("/streets/connect?strava=connected");
      },
    },
    "/streets/api/strava/backfill": {
      POST: async (request) => {
        const { login } = resolveViewer(identity, request);
        const [connection] = await db.select().from(connections).where(eq(connections.login, login));
        if (connection === undefined) {
          throw new HttpError(404, "Strava is not connected");
        }
        await restartBackfill(login);
        return new Response(null, { status: 202 });
      },
    },
    "/streets/api/uploads": {
      POST: async (request) => {
        const { login } = resolveViewer(identity, request);
        if (Number(request.headers.get("Content-Length") ?? 0) > MAX_UPLOAD_BYTES) {
          throw new HttpError(413, "Upload files one at a time, each under 30 MB");
        }
        const files = (await request.formData()).getAll("file").filter((file) => Upload.safeParse(file).success);
        if (files.length === 0) {
          throw new HttpError(400, "Expected GPX files in the `file` field");
        }
        const result: UploadResult = { imported: 0, duplicates: 0, failed: [] };
        for (const file of files as File[]) {
          try {
            if (await importUpload(login, file)) {
              result.imported += 1;
            } else {
              result.duplicates += 1;
            }
          } catch (error) {
            if (!(error instanceof GpxError)) {
              throw error;
            }
            result.failed.push({ filename: file.name, error: error.message });
          }
        }
        return Response.json(result, { status: 201 });
      },
    },
    "/streets/api/map": {
      GET: async (request) => {
        const { login } = resolveViewer(identity, request);
        const box = parseQuery(request, Viewport);
        if (box.north - box.south > MAX_MAP_SPAN.lat || box.east - box.west > MAX_MAP_SPAN.lon) {
          throw new HttpError(400, "Zoom in to see streets");
        }
        return Response.json({ streets: await mapStreets(login, box) });
      },
    },
    "/streets/api/stats": {
      GET: async (request) => Response.json(await stats(resolveViewer(identity, request).login)),
    },
    "/streets/api/suggestions": {
      GET: async (request) => {
        const { login } = resolveViewer(identity, request);
        const { lat, lon } = parseQuery(request, Start);
        if (!contains(LONDON, [lat, lon])) {
          throw new HttpError(400, "Start somewhere in London");
        }
        return Response.json(await suggestions(login, [lat, lon]));
      },
    },
    "/streets/api/activities": {
      GET: async (request) => Response.json(await activityList(resolveViewer(identity, request).login)),
    },
    "/streets/api/activities/rematch": {
      POST: async (request) => {
        await work.rematchAll(resolveViewer(identity, request).login);
        return new Response(null, { status: 202 });
      },
    },
    "/streets/api/network": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await networkStatus());
      },
    },
    "/streets/api/network/refresh": {
      POST: async (request) => {
        resolveViewer(identity, request);
        await work.refreshNetwork();
        return new Response(null, { status: 202 });
      },
    },
    "/streets/api/streets/:id/nodes": {
      GET: async (request) => {
        const { login } = resolveViewer(identity, request);
        const streetId = parseParam(request.params.id, z.coerce.number().int().positive());
        const rows = await db
          .select({ lat: nodes.lat, lon: nodes.lon, hit: sql<boolean>`${nodeHits.nodeId} is not null` })
          .from(nodes)
          .leftJoin(nodeHits, and(eq(nodeHits.nodeId, nodes.id), eq(nodeHits.login, login)))
          .where(eq(nodes.streetId, streetId));
        return Response.json(rows satisfies StreetNode[]);
      },
    },
    "/streets/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
};
