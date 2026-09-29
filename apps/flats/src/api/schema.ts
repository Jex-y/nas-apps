import { jsonb } from "@apps/core/columns";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { PROPERTY_STATUSES } from "../contract";
import { AVAILABILITIES, type ParsedListing, PORTALS, TENURES } from "./portals/listing";

export const flatsSchema = pgSchema("flats");

export const portal = flatsSchema.enum("portal", PORTALS);
export const tenure = flatsSchema.enum("tenure", TENURES);
export const availability = flatsSchema.enum("availability", AVAILABILITIES);
export const propertyStatus = flatsSchema.enum("property_status", PROPERTY_STATUSES);
export const snapshotSource = flatsSchema.enum("snapshot_source", ["search", "page"]);
export const photoKind = flatsSchema.enum("photo_kind", ["photo", "floorplan"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A saved search on a portal, polled for new listings. */
export const searches = flatsSchema.table("searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  portal: portal("portal").notNull(),
  url: text("url").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/**
 * The real-world flat, which is what gets triaged. Its facts mirror the most recently parsed listing page, so
 * lists and filters never need to join through snapshots.
 */
export const properties = flatsSchema.table(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: propertyStatus("status").notNull().default("new"),
    rejectedReason: text("rejected_reason"),
    notes: text("notes").notNull().default(""),
    address: text("address").notNull(),
    postcode: text("postcode"),
    outcode: text("outcode"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    price: integer("price"),
    priceQualifier: text("price_qualifier").notNull().default(""),
    availability: availability("availability").notNull().default("available"),
    propertyType: text("property_type").notNull().default(""),
    bedrooms: smallint("bedrooms"),
    bathrooms: smallint("bathrooms"),
    sizeSqft: integer("size_sqft"),
    tenure: tenure("tenure").notNull().default("unknown"),
    leaseYearsRemaining: smallint("lease_years_remaining"),
    annualServiceCharge: numeric("annual_service_charge", {
      precision: 10,
      scale: 2,
      mode: "number",
    }),
    annualGroundRent: numeric("annual_ground_rent", {
      precision: 10,
      scale: 2,
      mode: "number",
    }),
    councilTaxBand: text("council_tax_band"),
    sharedOwnership: boolean("shared_ownership").notNull().default(false),
    auction: boolean("auction").notNull().default(false),
    /** Remote URL of the first photo, shown until the mirrored copy exists. */
    thumbnailUrl: text("thumbnail_url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("properties_status_first_seen_idx").on(table.status, table.firstSeenAt)],
);

/** One advert for a property on one portal. */
export const listings = flatsSchema.table(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    portal: portal("portal").notNull(),
    portalId: text("portal_id").notNull(),
    url: text("url").notNull(),
    price: integer("price"),
    availability: availability("availability").notNull().default("available"),
    /** The last parsed listing page; `null` until the page has been fetched once. */
    parsed: jsonb<ParsedListing>("parsed"),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("listings_portal_id_unique").on(table.portal, table.portalId), index().on(table.propertyId)],
);

/** Every observed state of a listing; price and availability history is read from here. */
export const snapshots = flatsSchema.table(
  "snapshots",
  {
    id: uuid("id").primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    source: snapshotSource("source").notNull(),
    price: integer("price"),
    availability: availability("availability").notNull(),
    /** Gzipped raw page in blob storage, for re-parsing when a parser changes; page snapshots only. */
    pageKey: text("page_key"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.listingId, table.observedAt)],
);

export const photos = flatsSchema.table(
  "photos",
  {
    id: uuid("id").primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    kind: photoKind("kind").notNull(),
    position: smallint("position").notNull(),
    sourceUrl: text("source_url").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique("photos_listing_source_unique").on(table.listingId, table.sourceUrl)],
);

export const viewings = flatsSchema.table(
  "viewings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    rating: smallint("rating"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index().on(table.propertyId)],
);

export const viewingPhotos = flatsSchema.table(
  "viewing_photos",
  {
    id: uuid("id").primaryKey(),
    viewingId: uuid("viewing_id")
      .notNull()
      .references(() => viewings.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index().on(table.viewingId)],
);

/** A place commutes are timed to, e.g. work. */
export const destinations = flatsSchema.table("destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  postcode: text("postcode").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  /** London time to arrive by, `HH:MM`. */
  arriveBy: text("arrive_by").notNull(),
  createdAt: createdAt(),
});

export const commutes = flatsSchema.table(
  "commutes",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => destinations.id, { onDelete: "cascade" }),
    /** Fastest public-transport journey; `null` when TfL found no route. */
    minutes: smallint("minutes"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.propertyId, table.destinationId] })],
);
