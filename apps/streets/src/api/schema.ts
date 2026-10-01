import { jsonb } from "@apps/core/columns";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ACTIVITY_SOURCES, ACTIVITY_STATUSES, BACKFILL_STATES } from "../contract";
import type { LatLon } from "./geo";

export const streetsSchema = pgSchema("streets");

export const activitySource = streetsSchema.enum("activity_source", ACTIVITY_SOURCES);
export const activityStatus = streetsSchema.enum("activity_status", ACTIVITY_STATUSES);
export const backfillState = streetsSchema.enum("backfill_state", BACKFILL_STATES);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A run of the OpenStreetMap import; rows it writes carry its id as their generation, so stale ones can be swept. */
export const refreshes = streetsSchema.table("refreshes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  /** Planned once every borough's boundary is in; zero until then. */
  tiles: integer("tiles").notNull().default(0),
  tilesDone: integer("tiles_done").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** A London borough (or the City), keyed by its OpenStreetMap relation id. */
export const boroughs = streetsSchema.table("boroughs", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  /** Every outer and inner way of the boundary, unjoined; see `insideBoundary`. `null` until fetched each refresh. */
  boundary: jsonb<LatLon[][]>("boundary"),
  south: doublePrecision("south"),
  west: doublePrecision("west"),
  north: doublePrecision("north"),
  east: doublePrecision("east"),
  generation: integer("generation").notNull(),
});

/** The named ways of one name within one borough, as CityStrides groups them. */
export const streets = streetsSchema.table(
  "streets",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    boroughId: bigint("borough_id", { mode: "number" })
      .notNull()
      .references(() => boroughs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nodeCount: integer("node_count").notNull().default(0),
    /** The mean of its nodes, for suggestions; `null` until its first tile is imported. */
    centerLat: doublePrecision("center_lat"),
    centerLon: doublePrecision("center_lon"),
    cell: integer("cell"),
  },
  (table) => [unique("streets_borough_name_unique").on(table.boroughId, table.name), index().on(table.cell)],
);

/**
 * A point a run must pass near: an OSM vertex (keyed by its node id) or one interpolated along a way (keyed by a
 * negative number derived from the way). `real` keeps a million of them small and is still sub-metre.
 */
export const nodes = streetsSchema.table(
  "nodes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    streetId: integer("street_id")
      .notNull()
      .references(() => streets.id, { onDelete: "cascade" }),
    key: bigint("key", { mode: "number" }).notNull(),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    cell: integer("cell").notNull(),
    generation: integer("generation").notNull(),
  },
  (table) => [unique("nodes_street_key_unique").on(table.streetId, table.key), index().on(table.cell)],
);

/** A piece of a way no longer than a cell, for drawing; indexed by the cell of its first point. */
export const segments = streetsSchema.table(
  "segments",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    streetId: integer("street_id")
      .notNull()
      .references(() => streets.id, { onDelete: "cascade" }),
    wayId: bigint("way_id", { mode: "number" }).notNull(),
    seq: integer("seq").notNull(),
    cell: integer("cell").notNull(),
    path: jsonb<LatLon[]>("path").notNull(),
    generation: integer("generation").notNull(),
  },
  (table) => [unique("segments_way_seq_unique").on(table.wayId, table.seq), index().on(table.cell)],
);

/** One tailnet login's Strava authorisation. */
export const connections = streetsSchema.table("connections", {
  login: text("login").primaryKey(),
  athleteId: bigint("athlete_id", { mode: "number" }).notNull().unique(),
  athleteName: text("athlete_name").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scope: text("scope").notNull(),
  includeWalks: boolean("include_walks").notNull().default(false),
  backfill: backfillState("backfill").notNull().default("running"),
  backfillFinishedAt: timestamp("backfill_finished_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  /** Why the last Strava call failed for good, e.g. a revoked authorisation; cleared on success. */
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/** A run from Strava or an uploaded GPX file; its track is gzipped JSON in blob storage at `trackKey`. */
export const activities = streetsSchema.table(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    login: text("login").notNull(),
    source: activitySource("source").notNull(),
    /** Strava's activity id, or the SHA-256 of an uploaded file, so re-importing finds the same row. */
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    sportType: text("sport_type").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    distanceMetres: real("distance_metres"),
    status: activityStatus("status").notNull().default("pending"),
    trackKey: text("track_key"),
    south: doublePrecision("south"),
    west: doublePrecision("west"),
    north: doublePrecision("north"),
    east: doublePrecision("east"),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("activities_login_source_external_unique").on(table.login, table.source, table.externalId),
    index().on(table.login, table.startAt),
  ],
);

/** A node a login has run past, credited to the earliest activity that did. */
export const nodeHits = streetsSchema.table(
  "node_hits",
  {
    login: text("login").notNull(),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    hitAt: timestamp("hit_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.login, table.nodeId] }), index().on(table.activityId)],
);

/** Derived from `node_hits` by `recomputeProgress`, so lists and the map never aggregate hits themselves. */
export const streetProgress = streetsSchema.table(
  "street_progress",
  {
    login: text("login").notNull(),
    streetId: integer("street_id")
      .notNull()
      .references(() => streets.id, { onDelete: "cascade" }),
    hitCount: integer("hit_count").notNull(),
    /** When the street first reached the completion threshold, in activity time; `null` while unfinished. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedActivityId: uuid("completed_activity_id").references(() => activities.id, { onDelete: "set null" }),
  },
  (table) => [
    primaryKey({ columns: [table.login, table.streetId] }),
    index().on(table.login, table.completedAt),
    index().on(table.completedActivityId),
  ],
);
