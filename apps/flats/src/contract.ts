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

/** A question or option key: sent to Jev as a map key, so it must stay stable and readable. */
const Key = z.string().regex(/^[a-z][a-z0-9_]*$/, "Use lower_snake_case");
const Text = z.string().trim().min(1);

export const Option = z.strictObject({ label: Text, description: Text, points: z.number() });
export type Option = z.infer<typeof Option>;

export const ChoiceOption = z.strictObject({ key: Key, ...Option.shape });
export type ChoiceOption = z.infer<typeof ChoiceOption>;

const questionBase = { key: Key, label: Text, instructions: Text };

/** How a question is asked and what its answer is worth to the ranking. Strict, so a misspelt field is an error. */
export const Question = z.discriminatedUnion("kind", [
  /** Rules the property out when Jev is sure the answer is yes. */
  z.strictObject({ ...questionBase, kind: z.literal("exclusion"), reason: Text }),
  z.strictObject({
    ...questionBase,
    kind: z.literal("feature"),
    points: z.number(),
    criteria: z.strictObject({ yes: Text, no: Text }).optional(),
  }),
  z.strictObject({
    ...questionBase,
    kind: z.literal("choice"),
    /** A list, not a map: Postgres reorders a jsonb object's keys, which would change the question's wording. */
    options: z
      .array(ChoiceOption)
      .min(2)
      .max(255)
      .refine((options) => new Set(options.map((option) => option.key)).size === options.length, {
        message: "Option keys must be unique",
      }),
  }),
  /** Levels run from worst to best. */
  z.strictObject({ ...questionBase, kind: z.literal("score"), levels: z.array(Option).min(2).max(10) }),
]);
export type Question = z.infer<typeof Question>;

/** How sure Jev must be before an exclusion rules a property out. */
export const EXCLUSION_THRESHOLD = 0.8;

/** Facts a listing states that rule a property out; `null` turns a limit off. */
export const Limits = z.strictObject({
  minSizeSqft: z.number().int().positive().nullable(),
  maxAnnualServiceCharge: z.number().nonnegative().nullable(),
  minLeaseYears: z.number().int().positive().nullable(),
});
export type Limits = z.infer<typeof Limits>;

/** What a flat must be to stay in the hunt, and what makes one better than another. */
export const Requirements = z.strictObject({
  limits: Limits,
  questions: z
    .array(Question)
    .max(50)
    .refine((questions) => new Set(questions.map((question) => question.key)).size === questions.length, {
      message: "Question keys must be unique",
    }),
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

/** One reason a property scores as it does, e.g. `{ label: "Outdoor space", detail: "Balcony", points: 1.8 }`. */
export const Contribution = z.object({ label: z.string(), detail: z.string(), points: z.number() });
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
  ranking: Ranking,
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
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
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
