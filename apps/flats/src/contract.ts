import { z } from "zod";
import { AVAILABILITIES, PORTALS, TENURES } from "./api/portals/listing";

export const FLATS_API = "/flats/api";

/** Where a property sits in the hunt; whether it is still on the market is its separate `availability`. */
export const PROPERTY_STATUSES = ["new", "shortlisted", "viewing_booked", "viewed", "offer_made", "rejected"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

/** Statuses worth re-checking daily and alerting on when price or availability changes. */
export const TRACKED_STATUSES = [
  "shortlisted",
  "viewing_booked",
  "viewed",
  "offer_made",
] as const satisfies readonly PropertyStatus[];

export const Commute = z.object({
  destinationId: z.uuid(),
  name: z.string(),
  /** Fastest public-transport journey; `null` when TfL found no route. */
  minutes: z.number().nullable(),
});
export type Commute = z.infer<typeof Commute>;

export const PropertySummary = z.object({
  id: z.uuid(),
  status: z.enum(PROPERTY_STATUSES),
  address: z.string(),
  postcode: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  price: z.number().nullable(),
  priceQualifier: z.string(),
  availability: z.enum(AVAILABILITIES),
  propertyType: z.string(),
  bedrooms: z.number().nullable(),
  bathrooms: z.number().nullable(),
  sizeSqft: z.number().nullable(),
  tenure: z.enum(TENURES),
  leaseYearsRemaining: z.number().nullable(),
  annualServiceCharge: z.number().nullable(),
  annualGroundRent: z.number().nullable(),
  councilTaxBand: z.string().nullable(),
  sharedOwnership: z.boolean(),
  auction: z.boolean(),
  /** A mirrored photo when there is one, else the portal's own image URL. */
  thumbnailUrl: z.string().nullable(),
  firstSeenAt: z.iso.datetime(),
  listings: z.array(z.object({ portal: z.enum(PORTALS), url: z.url() })),
  /** Only the places already timed; the rest are still being computed. */
  commutes: z.array(Commute),
});
export type PropertySummary = z.infer<typeof PropertySummary>;

export const PropertyList = z.array(PropertySummary);

export const Photo = z.object({ id: z.uuid(), kind: z.enum(["photo", "floorplan"]), url: z.string() });
export type Photo = z.infer<typeof Photo>;

export const ViewingPhoto = z.object({ id: z.uuid(), filename: z.string(), url: z.string() });

export const Viewing = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  rating: z.number().int().min(1).max(5).nullable(),
  notes: z.string(),
  createdBy: z.string(),
  photos: z.array(ViewingPhoto),
});
export type Viewing = z.infer<typeof Viewing>;

export const PricePoint = z.object({
  observedAt: z.iso.datetime(),
  price: z.number().nullable(),
  availability: z.enum(AVAILABILITIES),
});
export type PricePoint = z.infer<typeof PricePoint>;

export const PropertyDetail = PropertySummary.extend({
  rejectedReason: z.string().nullable(),
  notes: z.string(),
  description: z.string(),
  keyFeatures: z.array(z.string()),
  nearestStations: z.array(z.object({ name: z.string(), miles: z.number() })),
  agent: z.object({ name: z.string(), phone: z.string().nullable() }).nullable(),
  photos: z.array(Photo),
  history: z.array(PricePoint),
  viewings: z.array(Viewing),
});
export type PropertyDetail = z.infer<typeof PropertyDetail>;

/** An absent or blank reason parses to `null`, so a rejection never stores an empty string. */
const RejectedReason = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((reason) => reason || null);

export const UpdateStatus = z.discriminatedUnion("status", [
  z.object({ status: z.literal("rejected"), reason: RejectedReason }),
  z.object({ status: z.enum(PROPERTY_STATUSES).exclude(["rejected"]) }),
]);
export type UpdateStatus = z.infer<typeof UpdateStatus>;

export const UpdateNotes = z.object({ notes: z.string().max(20_000) });

export const CreateViewing = z.object({
  at: z.iso.datetime({ offset: true }),
  rating: z.number().int().min(1).max(5).nullable(),
  notes: z.string().max(20_000),
});
export type CreateViewing = z.infer<typeof CreateViewing>;

export const Search = z.object({
  id: z.uuid(),
  name: z.string(),
  portal: z.enum(PORTALS),
  url: z.url(),
  enabled: z.boolean(),
  lastPolledAt: z.iso.datetime().nullable(),
  lastSucceededAt: z.iso.datetime().nullable(),
  consecutiveFailures: z.number(),
  lastError: z.string().nullable(),
});
export type Search = z.infer<typeof Search>;

export const SearchList = z.array(Search);

export const CreateSearch = z.object({ name: z.string().trim().min(1).max(100), url: z.url() });
export type CreateSearch = z.infer<typeof CreateSearch>;

export const UpdateSearch = z.object({ enabled: z.boolean() });

export const AddListing = z.object({ url: z.url() });
export type AddListing = z.infer<typeof AddListing>;

export const MAX_VIEWING_PHOTO_BYTES = 25 * 1024 * 1024;

const ARRIVE_BY = /^([01]\d|2[0-3]):[0-5]\d$/;

export const Destination = z.object({
  id: z.uuid(),
  name: z.string(),
  postcode: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  arriveBy: z.string().regex(ARRIVE_BY),
});
export type Destination = z.infer<typeof Destination>;

export const DestinationList = z.array(Destination);

export const CreateDestination = z.object({
  name: z.string().trim().min(1).max(60),
  postcode: z.string().trim().min(5).max(8),
  /** London time to arrive by on a weekday, `HH:MM`. */
  arriveBy: z.string().regex(ARRIVE_BY),
});
export type CreateDestination = z.infer<typeof CreateDestination>;

/** The palette annotation layers are drawn in. */
export const LAYER_COLOURS = ["#d6364f", "#f08c00", "#03955a", "#1c7ed6", "#7048e8", "#d45bb6"] as const;

/** Pen widths in screen pixels. */
export const STROKE_WIDTHS = [3, 6, 14] as const;

const LatLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const MapStroke = z.object({
  id: z.uuid(),
  points: z.array(LatLng).min(1).max(5_000),
  width: z.number().int().min(1).max(40),
});
export type MapStroke = z.infer<typeof MapStroke>;

export const MapLayer = z.object({
  id: z.uuid(),
  name: z.string(),
  colour: z.enum(LAYER_COLOURS),
  visible: z.boolean(),
  /** Oldest first, so later strokes draw on top. */
  strokes: z.array(MapStroke),
});
export type MapLayer = z.infer<typeof MapLayer>;

export const MapLayerList = z.array(MapLayer);

export const CreateMapLayer = z.object({ name: z.string().trim().min(1).max(60), colour: z.enum(LAYER_COLOURS) });
export type CreateMapLayer = z.infer<typeof CreateMapLayer>;

export const UpdateMapLayer = CreateMapLayer.extend({ visible: z.boolean() })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "Nothing to update");
