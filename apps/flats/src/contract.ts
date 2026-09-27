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
