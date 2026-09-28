import { and, eq, sql } from "drizzle-orm";
import type { FlatsDb } from "./db";
import type { Availability, ParsedListing, SearchHit } from "./portals/listing";
import { listings, properties, snapshots } from "./schema";

/** Why a property the portal marks as shared ownership was rejected without being triaged. */
export const SHARED_OWNERSHIP_REASON = "Shared ownership";

/** The smallest floor area worth viewing. */
const MIN_SIZE_SQFT = 650;
export const TOO_SMALL_REASON = `Under ${MIN_SIZE_SQFT} sq ft`;

/** The largest annual service charge worth paying. */
const MAX_ANNUAL_SERVICE_CHARGE = 6000;
export const SERVICE_CHARGE_REASON = `Service charge over £${MAX_ANNUAL_SERVICE_CHARGE.toLocaleString("en-GB")}`;

/** What a portal now says that differs from what we last recorded. */
export type ListingChange = {
  readonly propertyId: string;
  readonly listingId: string;
  readonly price: { readonly from: number | null; readonly to: number | null } | null;
  readonly availability: { readonly from: Availability; readonly to: Availability } | null;
};

export type HitOutcome =
  | { readonly kind: "new"; readonly listingId: string }
  | { readonly kind: "changed"; readonly change: ListingChange }
  | { readonly kind: "unchanged"; readonly listingId: string };

const diff = (
  ids: { readonly propertyId: string; readonly listingId: string },
  before: { readonly price: number | null; readonly availability: Availability },
  after: { readonly price: number | null; readonly availability: Availability },
): ListingChange | null => {
  const price = before.price === after.price ? null : { from: before.price, to: after.price };
  const availability =
    before.availability === after.availability ? null : { from: before.availability, to: after.availability };
  return price === null && availability === null ? null : { ...ids, price, availability };
};

/** Records one search result: a new listing and property, or a price or status change on a known one. */
export const recordSearchHit = (db: FlatsDb, hit: SearchHit): Promise<HitOutcome> =>
  db.transaction(async (tx) => {
    const [known] = await tx
      .select({
        listingId: listings.id,
        propertyId: listings.propertyId,
        price: listings.price,
        availability: listings.availability,
      })
      .from(listings)
      .where(and(eq(listings.portal, hit.portal), eq(listings.portalId, hit.portalId)))
      .for("update");

    if (known === undefined) {
      const [property] = await tx
        .insert(properties)
        .values({
          address: hit.address,
          price: hit.price.amount,
          priceQualifier: hit.price.qualifier,
          availability: hit.availability,
          bedrooms: hit.bedrooms,
          bathrooms: hit.bathrooms,
          auction: hit.auction,
          thumbnailUrl: hit.photos[0]?.url ?? null,
        })
        .returning({ id: properties.id });
      if (property === undefined) {
        throw new Error("INSERT … RETURNING produced no property");
      }
      const [listing] = await tx
        .insert(listings)
        .values({
          propertyId: property.id,
          portal: hit.portal,
          portalId: hit.portalId,
          url: hit.url,
          price: hit.price.amount,
          availability: hit.availability,
        })
        .returning({ id: listings.id });
      if (listing === undefined) {
        throw new Error("INSERT … RETURNING produced no listing");
      }
      await tx.insert(snapshots).values({
        id: Bun.randomUUIDv7(),
        listingId: listing.id,
        source: "search",
        price: hit.price.amount,
        availability: hit.availability,
      });
      return { kind: "new", listingId: listing.id };
    }

    const change = diff(known, known, { price: hit.price.amount, availability: hit.availability });
    await tx
      .update(listings)
      .set({ lastSeenAt: sql`now()`, price: hit.price.amount, availability: hit.availability })
      .where(eq(listings.id, known.listingId));
    if (change === null) {
      return { kind: "unchanged", listingId: known.listingId };
    }
    await tx.insert(snapshots).values({
      id: Bun.randomUUIDv7(),
      listingId: known.listingId,
      source: "search",
      price: hit.price.amount,
      availability: hit.availability,
    });
    await tx
      .update(properties)
      .set({
        price: hit.price.amount,
        priceQualifier: hit.price.qualifier,
        availability: hit.availability,
        updatedAt: sql`now()`,
      })
      .where(eq(properties.id, known.propertyId));
    return { kind: "changed", change };
  });

/** The property columns a parsed listing page determines. */
export const propertyFacts = (parsed: ParsedListing) => ({
  address: parsed.address,
  postcode: parsed.postcode,
  outcode: parsed.outcode,
  latitude: parsed.location?.latitude ?? null,
  longitude: parsed.location?.longitude ?? null,
  price: parsed.price.amount,
  priceQualifier: parsed.price.qualifier,
  availability: parsed.availability,
  propertyType: parsed.propertyType,
  bedrooms: parsed.bedrooms,
  bathrooms: parsed.bathrooms,
  sizeSqft: parsed.sizeSqft === null ? null : Math.round(parsed.sizeSqft),
  tenure: parsed.tenure,
  leaseYearsRemaining: parsed.leaseYearsRemaining,
  annualServiceCharge: parsed.annualServiceCharge,
  annualGroundRent: parsed.annualGroundRent,
  councilTaxBand: parsed.councilTaxBand,
  sharedOwnership: parsed.sharedOwnership,
  thumbnailUrl: parsed.photos[0]?.url ?? null,
});

/** Why a property's facts rule it out before triage, or `null`; a fact the listing doesn't state rules nothing out. */
const disqualification = (facts: ReturnType<typeof propertyFacts>): string | null => {
  if (facts.sharedOwnership) {
    return SHARED_OWNERSHIP_REASON;
  }
  if (facts.sizeSqft !== null && facts.sizeSqft < MIN_SIZE_SQFT) {
    return TOO_SMALL_REASON;
  }
  if (facts.annualServiceCharge !== null && facts.annualServiceCharge > MAX_ANNUAL_SERVICE_CHARGE) {
    return SERVICE_CHARGE_REASON;
  }
  return null;
};

/**
 * Records a freshly parsed listing page (whose raw copy is already stored at `pageKey`) and brings the property's
 * facts up to date; returns what changed since the last observation. A page whose facts disqualify the property
 * (shared ownership, too small, too high a service charge) rejects it unless it has already been triaged.
 */
export const recordListingPage = (
  db: FlatsDb,
  listingId: string,
  observed:
    | { readonly kind: "page"; readonly parsed: ParsedListing; readonly pageKey: string }
    | { readonly kind: "gone" },
): Promise<ListingChange | null> =>
  db.transaction(async (tx) => {
    const [known] = await tx
      .select({
        listingId: listings.id,
        propertyId: listings.propertyId,
        price: listings.price,
        availability: listings.availability,
      })
      .from(listings)
      .where(eq(listings.id, listingId))
      .for("update");
    if (known === undefined) {
      throw new Error(`Listing ${listingId} does not exist`);
    }

    const after =
      observed.kind === "page"
        ? { price: observed.parsed.price.amount, availability: observed.parsed.availability }
        : { price: known.price, availability: "removed" as const };

    await tx.insert(snapshots).values({
      id: Bun.randomUUIDv7(),
      listingId,
      source: "page",
      ...after,
      pageKey: observed.kind === "page" ? observed.pageKey : null,
    });
    await tx
      .update(listings)
      .set({
        ...after,
        lastSeenAt: sql`now()`,
        ...(observed.kind === "page" && { parsed: observed.parsed, parsedAt: sql`now()` }),
      })
      .where(eq(listings.id, listingId));
    const facts = observed.kind === "page" ? propertyFacts(observed.parsed) : null;
    await tx
      .update(properties)
      .set({ ...(facts ?? { availability: "removed" }), updatedAt: sql`now()` })
      .where(eq(properties.id, known.propertyId));
    const rejectedReason = facts === null ? null : disqualification(facts);
    if (rejectedReason !== null) {
      await tx
        .update(properties)
        .set({ status: "rejected", rejectedReason })
        .where(and(eq(properties.id, known.propertyId), eq(properties.status, "new")));
    }

    return diff(known, known, after);
  });

/** A listing page read as if it were a search result, for listings added by URL rather than found by a search. */
export const hitFromListing = (parsed: ParsedListing): SearchHit => ({
  portal: parsed.portal,
  portalId: parsed.portalId,
  url: parsed.url,
  address: parsed.address,
  price: parsed.price,
  availability: parsed.availability,
  bedrooms: parsed.bedrooms,
  bathrooms: parsed.bathrooms,
  auction: false,
  sharedOwnership: parsed.sharedOwnership,
  photos: parsed.photos,
});
