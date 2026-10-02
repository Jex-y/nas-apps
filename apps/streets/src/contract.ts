import { z } from "zod";

export const STREETS_API = "/streets/api";

export const ACTIVITY_SOURCES = ["strava", "gpx"] as const;
export const ACTIVITY_STATUSES = ["pending", "matched", "no_track"] as const;
export const BACKFILL_STATES = ["running", "done"] as const;

/** A node counts as run when a track passes within this distance of it (CityStrides' rule). */
export const MATCH_RADIUS_METRES = 25;
/** A street is complete once this share of its nodes is run (CityStrides' rule). */
export const COMPLETION_PERCENT = 90;
/** Nodes are added along a way wherever OSM's own are further apart, so running only the cross streets is not enough. */
export const NODE_SPACING_METRES = 50;

/** Rounds up, so a street of fewer than ten nodes needs every one of them, as on CityStrides. */
export const requiredNodes = (nodeCount: number): number => Math.ceil((nodeCount * COMPLETION_PERCENT) / 100);

const LatLon = z.tuple([z.number(), z.number()]).readonly();

export const StravaStatus = z.object({
  /** Whether the server has Strava API credentials at all. */
  configured: z.boolean(),
  connection: z
    .object({
      athleteName: z.string(),
      includeWalks: z.boolean(),
      includeRides: z.boolean(),
      backfill: z.enum(BACKFILL_STATES),
      backfillFinishedAt: z.iso.datetime().nullable(),
      lastPolledAt: z.iso.datetime().nullable(),
      lastError: z.string().nullable(),
    })
    .nullable(),
  /** This login's activities by import status, from any source. */
  activities: z.record(z.enum(ACTIVITY_STATUSES), z.number()),
});
export type StravaStatus = z.infer<typeof StravaStatus>;

/** Which activities count besides runs; a field left out keeps its setting. */
export const UpdateStrava = z
  .object({ includeWalks: z.boolean(), includeRides: z.boolean() })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Nothing to change" });
export type UpdateStrava = z.infer<typeof UpdateStrava>;

export const NetworkStatus = z.object({
  boroughs: z.number(),
  streets: z.number(),
  nodes: z.number(),
  /** The latest import from OpenStreetMap; `null` before the first. */
  refresh: z
    .object({
      startedAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().nullable(),
      tiles: z.number(),
      tilesDone: z.number(),
    })
    .nullable(),
});
export type NetworkStatus = z.infer<typeof NetworkStatus>;

export const STREET_STATES = ["complete", "partial", "untouched"] as const;
export type StreetState = (typeof STREET_STATES)[number];

export const MapStreet = z.object({
  id: z.number(),
  name: z.string(),
  state: z.enum(STREET_STATES),
  hitCount: z.number(),
  nodeCount: z.number(),
  paths: z.array(z.array(LatLon)),
});
export type MapStreet = z.infer<typeof MapStreet>;

export const MapView = z.object({ streets: z.array(MapStreet) });
export type MapView = z.infer<typeof MapView>;

export const StreetNode = z.object({ lat: z.number(), lon: z.number(), hit: z.boolean() });
export type StreetNode = z.infer<typeof StreetNode>;

export const StreetNodeList = z.array(StreetNode);

export const Progress = z.object({
  streets: z.number(),
  completed: z.number(),
  nodes: z.number(),
  nodesHit: z.number(),
});
export type Progress = z.infer<typeof Progress>;

export const BoroughProgress = z.object({
  id: z.number(),
  name: z.string(),
  streets: z.number(),
  completed: z.number(),
});
export type BoroughProgress = z.infer<typeof BoroughProgress>;

export const CompletedStreet = z.object({
  id: z.number(),
  name: z.string(),
  borough: z.string(),
  completedAt: z.iso.datetime(),
  activityName: z.string().nullable(),
});
export type CompletedStreet = z.infer<typeof CompletedStreet>;

export const WeekCount = z.object({
  /** Monday of the week, London time, `YYYY-MM-DD`. */
  week: z.iso.date(),
  streets: z.number(),
});
export type WeekCount = z.infer<typeof WeekCount>;

export const Stats = z.object({
  overall: Progress,
  boroughs: z.array(BoroughProgress),
  recent: z.array(CompletedStreet),
  /** The last few weeks, oldest first, including weeks with none. */
  weeks: z.array(WeekCount),
  /** Consecutive weeks up to this one (or last, if this one has none yet) with at least one new street. */
  streakWeeks: z.number(),
});
export type Stats = z.infer<typeof Stats>;

export const Suggestion = z.object({
  lat: z.number(),
  lon: z.number(),
  distanceMetres: z.number(),
  streets: z.array(z.object({ id: z.number(), name: z.string(), remainingNodes: z.number() })),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const SuggestionList = z.array(Suggestion);

export const NearbyStreet = z.object({
  id: z.number(),
  name: z.string(),
  borough: z.string(),
  /** The mean of the street's nodes. */
  lat: z.number(),
  lon: z.number(),
  distanceMetres: z.number(),
  state: z.enum(STREET_STATES),
  hitCount: z.number(),
  nodeCount: z.number(),
});
export type NearbyStreet = z.infer<typeof NearbyStreet>;

/** How a Strava authorisation round trip ended; the connect page says which. */
export const CONNECT_OUTCOMES = ["connected", "denied", "scope"] as const;
export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number];

export const Activity = z.object({
  id: z.uuid(),
  source: z.enum(ACTIVITY_SOURCES),
  name: z.string(),
  sportType: z.string(),
  startAt: z.iso.datetime(),
  distanceMetres: z.number().nullable(),
  status: z.enum(ACTIVITY_STATUSES),
  /** Streets this activity was the one to complete. */
  newStreets: z.number(),
});
export type Activity = z.infer<typeof Activity>;

export const ActivityList = z.array(Activity);

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export const UploadResult = z.object({
  imported: z.number(),
  duplicates: z.number(),
  failed: z.array(z.object({ filename: z.string(), error: z.string() })),
});
export type UploadResult = z.infer<typeof UploadResult>;
