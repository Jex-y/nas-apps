export const PORTALS = ["rightmove", "zoopla"] as const;
export type Portal = (typeof PORTALS)[number];

export const TENURES = ["freehold", "leasehold", "share_of_freehold", "commonhold", "unknown"] as const;
export type Tenure = (typeof TENURES)[number];

export const AVAILABILITIES = ["available", "under_offer", "sold_stc", "removed"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export type Price = {
  /** Whole pounds; `null` for "POA" and other unpriced listings. */
  readonly amount: number | null;
  /** e.g. "Guide Price", "Offers in Excess of"; empty when there is none. */
  readonly qualifier: string;
};

export type Photo = {
  readonly url: string;
  readonly caption: string;
};

/** What a search results page says about one listing: enough to spot new listings and price or status changes. */
export type SearchHit = {
  readonly portal: Portal;
  readonly portalId: string;
  readonly url: string;
  readonly address: string;
  readonly price: Price;
  readonly availability: Availability;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly auction: boolean;
  /** Shared ownership or another affordable-buying scheme; these are kept out of triage. */
  readonly sharedOwnership: boolean;
  readonly photos: readonly Photo[];
};

export type Station = {
  readonly name: string;
  readonly miles: number;
};

/** Everything a listing page says about a property, in portal-neutral terms. */
export type ParsedListing = {
  readonly portal: Portal;
  readonly portalId: string;
  readonly url: string;
  readonly availability: Availability;
  readonly address: string;
  /** e.g. "TW7 6GH"; `null` when the portal withholds the incode. */
  readonly postcode: string | null;
  readonly outcode: string | null;
  readonly location: { readonly latitude: number; readonly longitude: number } | null;
  readonly price: Price;
  readonly propertyType: string;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly sizeSqft: number | null;
  readonly tenure: Tenure;
  readonly leaseYearsRemaining: number | null;
  readonly annualServiceCharge: number | null;
  readonly annualGroundRent: number | null;
  readonly councilTaxBand: string | null;
  /** Shared ownership or another affordable-buying scheme; these are kept out of triage. */
  readonly sharedOwnership: boolean;
  readonly description: string;
  readonly keyFeatures: readonly string[];
  readonly photos: readonly Photo[];
  readonly floorplans: readonly Photo[];
  readonly nearestStations: readonly Station[];
  readonly agent: { readonly name: string; readonly phone: string | null } | null;
};

const SHARED_OWNERSHIP = /(?<!\b(?:non-?|not (?:an? )?|no )\s*)\bshared[- ]ownership\b/i;

/** For portals without a structured flag: whether an advert's own words say it is shared ownership. */
export const mentionsSharedOwnership = (...texts: readonly string[]): boolean =>
  texts.some((text) => SHARED_OWNERSHIP.test(text));

/** A portal's pages changed shape; retrying will not help until the parser is updated. */
export class ParseError extends Error {}

export type PortalParser = {
  readonly portal: Portal;
  /** The search URL to fetch for the newest listings, from the saved-search URL Ed pasted. */
  readonly newestFirst: (searchUrl: string, offset: number) => string;
  readonly listingUrl: (portalId: string) => string;
  /** Recognises this portal's listing URLs, e.g. from the add-by-URL bookmarklet. */
  readonly portalIdFromUrl: (url: string) => string | null;
  readonly parseSearch: (html: string) => readonly SearchHit[];
  readonly parseListing: (html: string, portalId: string) => ParsedListing;
};
