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

/** Street crime the police recorded near a property; see crime.ts for how near. */
export const CrimeSummary = z.object({
  /** Crimes a month on average, over `months` months to `throughMonth`. */
  perMonth: z.number(),
  months: z.number(),
  /** The latest month counted, `YYYY-MM`; the police publish a month or two behind. */
  throughMonth: z.string(),
  radiusMetres: z.number(),
  /** Crimes over the whole period by police.uk category, e.g. `violent-crime`. */
  byCategory: z.record(z.string(), z.number()),
});
export type CrimeSummary = z.infer<typeof CrimeSummary>;

/** One earlier sale of a property, as the Land Registry recorded it; the portal gives the year, not the day. */
export const PastSale = z.object({ year: z.number().int(), price: z.number().positive() });
export type PastSale = z.infer<typeof PastSale>;

export const Commute = z.object({
  destinationId: z.uuid(),
  name: z.string(),
  /** Fastest public-transport journey; `null` when TfL found no route. */
  minutes: z.number().nullable(),
});
export type Commute = z.infer<typeof Commute>;

/** A question or option key: sent to Jev as a map key, so it must stay stable and readable. */
const Key = z.string().regex(/^[a-z][a-z0-9_]*$/, "Use lower_snake_case");
const Text = z.string().trim().min(1);

export const Option = z.strictObject({
  label: Text.describe("The answer's name in the app"),
  description: Text.describe("What this answer means, as Jev reads it; rewording it asks Jev again"),
  points: z.number().describe("Points this answer adds to a score, in proportion to how sure Jev is"),
});
export type Option = z.infer<typeof Option>;

export const ChoiceOption = z.strictObject({
  key: Key.describe("The option's stable id, sent to Jev; changing it asks Jev again"),
  ...Option.shape,
});
export type ChoiceOption = z.infer<typeof ChoiceOption>;

const questionBase = {
  key: Key.describe("The question's stable id; changing it discards Jev's answers"),
  label: Text.describe("The question's name in the app"),
  instructions: Text.describe(
    "What Jev is asked. Name the listing fields it reads in backticks: `description`, `key_features`, `property_type`",
  ),
};

/** How a question is asked and what its answer is worth to the ranking. Strict, so a misspelt field is an error. */
export const Question = z.discriminatedUnion("kind", [
  z.strictObject({
    ...questionBase,
    kind: z.literal("exclusion").describe("Rules a flat out when Jev is more than 80% sure the answer is yes"),
    reason: Text.describe("Why the flat was ruled out, as shown in the app"),
  }),
  z.strictObject({
    ...questionBase,
    kind: z.literal("feature").describe("A yes or no question that adds points when the answer is yes"),
    points: z.number().describe("Points a yes adds, in proportion to how sure Jev is"),
    criteria: z
      .strictObject({ yes: Text, no: Text })
      .optional()
      .describe("What counts as yes and as no, when the question alone is ambiguous"),
  }),
  z.strictObject({
    ...questionBase,
    kind: z.literal("choice").describe("Jev picks the one option that fits best"),
    /** A list, not a map: Postgres reorders a jsonb object's keys, which would change the question's wording. */
    options: z
      .array(ChoiceOption)
      .min(2)
      .max(255)
      .refine((options) => new Set(options.map((option) => option.key)).size === options.length, {
        message: "Option keys must be unique",
      })
      .describe("The answers Jev chooses between"),
  }),
  z.strictObject({
    ...questionBase,
    kind: z.literal("score").describe("Jev places the flat on a scale of levels"),
    levels: z.array(Option).min(2).max(10).describe("The scale, from worst to best"),
  }),
]);
export type Question = z.infer<typeof Question>;

/** How sure Jev must be before an exclusion rules a property out. */
export const EXCLUSION_THRESHOLD = 0.8;

/** Facts a listing states that rule a property out; `null` turns a limit off. */
export const Limits = z.strictObject({
  minSizeSqft: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Rule out flats smaller than this, in sq ft; null for no limit"),
  maxAnnualServiceCharge: z
    .number()
    .nonnegative()
    .nullable()
    .describe("Rule out flats with a yearly service charge above this, in £; null for no limit"),
  minLeaseYears: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Rule out leases with fewer years left than this; null for no limit"),
});
export type Limits = z.infer<typeof Limits>;

/** Structured facts a rule can score, each read from the listing or computed; see `FACTS` in scoring.ts. */
export const FACT_KEYS = [
  "commute_minutes",
  "percent_below_median_price",
  "size_sqft",
  "bedrooms",
  "bathrooms",
  "lease_years",
  "annual_service_charge",
  "crime_per_month",
  "last_sold_year",
  "percent_above_last_sale",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/**
 * Scores a structured fact on a line, `perUnit × (value − from)`, held between `min` and `max`; `null` leaves that
 * side open. A commute rule scores each destination separately.
 */
export const FactRule = z
  .strictObject({
    fact: z.enum(FACT_KEYS).describe("The fact to score; a commute scores each destination separately"),
    from: z.number().describe("The value that scores nothing"),
    perUnit: z.number().describe("Points for each unit above `from`; negative to take points away"),
    min: z.number().nullable().describe("The fewest points the fact can give; null for no floor"),
    max: z.number().nullable().describe("The most points the fact can give; null for no cap"),
  })
  .refine((rule) => rule.min === null || rule.max === null || rule.min <= rule.max, {
    message: "min must not exceed max",
    path: ["min"],
  });
export type FactRule = z.infer<typeof FactRule>;

/** Each 10 minutes' commute over 40 costs a point; each 5% cheaper per sq ft than the inbox is worth one, up to 4. */
export const DEFAULT_FACT_RULES: readonly FactRule[] = [
  { fact: "commute_minutes", from: 40, perUnit: -0.1, min: null, max: 0 },
  { fact: "percent_below_median_price", from: 0, perUnit: 0.2, min: -4, max: 4 },
];

/** What a flat must be to stay in the hunt, and what makes one better than another. */
export const Requirements = z.strictObject({
  limits: Limits.describe("Facts that rule a flat out as it arrives"),
  questions: z
    .array(Question)
    .max(50)
    .refine((questions) => new Set(questions.map((question) => question.key)).size === questions.length, {
      message: "Question keys must be unique",
    })
    .describe("What Jev reads from each listing: exclusions rule flats out, the rest score them"),
  /** Absent from documents saved before facts were scored, which keep scoring by the defaults. */
  facts: z
    .array(FactRule)
    .refine((rules) => new Set(rules.map((rule) => rule.fact)).size === rules.length, {
      message: "Score each fact once",
    })
    .default(() => [...DEFAULT_FACT_RULES])
    .describe("How facts the listings state, or TfL times, add to a score"),
});
export type Requirements = z.infer<typeof Requirements>;

export const Answer = z.discriminatedUnion("kind", [
  /** Probability that the answer is yes. */
  z.object({ kind: z.literal("noul"), yes: z.number() }),
  /** Probability of each option, by option key. */
  z.object({ kind: z.literal("choice"), probabilities: z.record(z.string(), z.number()) }),
  /** Probability of each level, in the question's order. */
  z.object({ kind: z.literal("score"), probabilities: z.array(z.number()) }),
]);
export type Answer = z.infer<typeof Answer>;

/** Jev's answer to a question as it was worded when asked, identified by `fingerprint` (see questions.ts). */
/** Jev's answer to a question worded as `fingerprint` says, about a property's current listing text. */
export const StoredAnswer = z.object({ fingerprint: z.string(), answer: Answer });
export type StoredAnswer = z.infer<typeof StoredAnswer>;

/**
 * One reason a property scores as it does, e.g. `{ label: "Outdoor space", detail: "Balcony", points: 1.8 }`. `key`
 * names the same reason on every property: the question's key, the fact's, or `commute_minutes:<destination id>`.
 */
export const Contribution = z.object({
  key: z.string(),
  source: z.enum(["jev", "fact"]),
  label: z.string(),
  detail: z.string(),
  points: z.number(),
});
export type Contribution = z.infer<typeof Contribution>;

export const Ranking = z.discriminatedUnion("kind", [
  /** Jev is sure the listing rules the property out, e.g. a retirement flat. */
  z.object({ kind: z.literal("excluded"), reason: z.string() }),
  /** Higher is better; contributions run from the largest effect to the smallest. */
  z.object({ kind: z.literal("scored"), total: z.number(), contributions: z.array(Contribution) }),
]);
export type Ranking = z.infer<typeof Ranking>;

export const PropertySummary = z.object({
  id: z.uuid(),
  status: z.enum(PROPERTY_STATUSES),
  address: z.string(),
  postcode: z.string().nullable(),
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
  /** `null` until counted, or for a property with no known location. */
  crime: CrimeSummary.nullable(),
  /** The most recent sale; `null` until looked up, or when the portal knows of none. */
  lastSale: PastSale.nullable(),
  ranking: Ranking,
});
export type PropertySummary = z.infer<typeof PropertySummary>;

export const PropertyList = z.array(PropertySummary);

/** A property with what the requirements editor needs to rank it by a draft in the browser. */
export const WorkbenchProperty = PropertySummary.extend({
  rejectedReason: z.string().nullable(),
  answers: z.array(StoredAnswer),
  /** Whether its listing page has been read, so Jev can be asked about it. */
  readable: z.boolean(),
});
export type WorkbenchProperty = z.infer<typeof WorkbenchProperty>;

export const Workbench = z.object({
  /** Of the properties still to triage, as scoring reads it. */
  medianPricePerSqft: z.number().nullable(),
  properties: z.array(WorkbenchProperty),
});
export type Workbench = z.infer<typeof Workbench>;

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
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  description: z.string(),
  keyFeatures: z.array(z.string()),
  nearestStations: z.array(z.object({ name: z.string(), miles: z.number() })),
  agent: z.object({ name: z.string(), phone: z.string().nullable() }).nullable(),
  photos: z.array(Photo),
  history: z.array(PricePoint),
  /** Earlier sales, newest first. */
  sales: z.array(PastSale),
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

/** Where the server serves MapLibre's web worker; see mapWorker.ts. */
export const MAP_WORKER_PATH = "/flats/api/map/worker.js";

/** A listed property where it is, with what the map shows about it. */
export const MapProperty = PropertySummary.pick({
  id: true,
  status: true,
  address: true,
  postcode: true,
  price: true,
  priceQualifier: true,
  bedrooms: true,
  sizeSqft: true,
  thumbnailUrl: true,
  crime: true,
  ranking: true,
}).extend({ latitude: z.number(), longitude: z.number() });
export type MapProperty = z.infer<typeof MapProperty>;

export const MapPlace = z.object({ id: z.uuid(), name: z.string(), latitude: z.number(), longitude: z.number() });
export type MapPlace = z.infer<typeof MapPlace>;

export const MapData = z.object({ properties: z.array(MapProperty), places: z.array(MapPlace) });
export type MapData = z.infer<typeof MapData>;

/** The part of the map in view, from the query string. */
export const MapBounds = z
  .object({
    south: z.coerce.number().min(-90).max(90),
    west: z.coerce.number().min(-180).max(180),
    north: z.coerce.number().min(-90).max(90),
    east: z.coerce.number().min(-180).max(180),
  })
  .refine((bounds) => bounds.south < bounds.north && bounds.west < bounds.east, {
    message: "south must be below north, and west left of east",
  });
export type MapBounds = z.infer<typeof MapBounds>;

/** Street crime in view, counted in square cells over the latest months stored. */
export const CrimeCells = z.object({
  /** `null` until crime has been counted anywhere. */
  throughMonth: z.string().nullable(),
  months: z.number(),
  cellMetres: z.number(),
  cells: z.array(z.object({ latitude: z.number(), longitude: z.number(), count: z.number() })),
});
export type CrimeCells = z.infer<typeof CrimeCells>;

export const TrialRequest = z.object({ requirements: Requirements, propertyId: z.uuid() });
export type TrialRequest = z.infer<typeof TrialRequest>;

/** How a draft of the requirements judges one property, without saving anything. */
export const Trial = z.object({
  /** The limit the property's facts break, if any. */
  rejectedBy: z.string().nullable(),
  ranking: Ranking,
  /** Each draft question's answer, in order; `null` for one Jev did not answer. */
  answers: z.array(z.object({ key: z.string(), answer: Answer.nullable() })),
  /** How many questions went to Jev; the rest were already answered in the same words. */
  asked: z.number(),
  /** What Jev read. */
  listing: z.object({ propertyType: z.string(), keyFeatures: z.array(z.string()), description: z.string() }),
});
export type Trial = z.infer<typeof Trial>;
