import type { BlobStore, JobQueue, Notifier, RegisteredJob, Schedule } from "@apps/core";
import { defineJob, defineSchedule, PermanentJobError } from "@apps/core";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { TRACKED_STATUSES } from "../contract";
import type { FlatsDb } from "./db";
import type { Fetcher } from "./fetcher";
import { hitFromListing, type ListingChange, recordListingPage, recordSearchHit } from "./ingest";
import { type JourneyPlanner, nextTuesday } from "./places";
import { type ParsedListing, ParseError, PORTALS, type Portal, type PortalParser } from "./portals/listing";
import { commutes, destinations, listings, photos, properties, searches } from "./schema";

export type FlatsWorkDeps = {
  readonly db: FlatsDb;
  readonly blob: BlobStore;
  readonly queue: JobQueue;
  readonly notifier: Notifier;
  readonly fetcher: Fetcher;
  /** `null` when no TfL key is configured; commutes are then left uncomputed. */
  readonly planner: JourneyPlanner | null;
  readonly parsers: Readonly<Partial<Record<Portal, PortalParser>>>;
  readonly publicUrl: string;
  readonly now: () => Date;
};

/** A search that fails this many polls in a row is paused and reported, rather than hammered. */
export const MAX_CONSECUTIVE_FAILURES = 3;
/** Results per Rightmove search page; the offset of page n is n × this. */
const PAGE_SIZE = 24;
const MIRRORED_PHOTOS = 12;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Polling pauses overnight (London time) so the traffic keeps human hours. */
export const isActiveHour = (at: Date): boolean => {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(at),
  );
  return hour >= 7 && hour < 23;
};

/** Properties worth timing commutes for: not rejected and still advertised. */
const inPlay = and(ne(properties.status, "rejected"), ne(properties.availability, "removed"));

const formatPrice = (price: number | null) => (price === null ? "POA" : `£${price.toLocaleString("en-GB")}`);

const describeChange = (change: ListingChange): string =>
  [
    change.price && `Price ${formatPrice(change.price.from)} → ${formatPrice(change.price.to)}`,
    change.availability && `Now ${change.availability.to.replace("_", " ")}`,
  ]
    .filter(Boolean)
    .join(". ");

const describeArrival = (arrival: {
  readonly price: number | null;
  readonly bedrooms: number | null;
  readonly sizeSqft: number | null;
}): string =>
  [
    formatPrice(arrival.price),
    arrival.bedrooms !== null && `${arrival.bedrooms} bed`,
    arrival.sizeSqft !== null && `${arrival.sizeSqft.toLocaleString("en-GB")} sq ft`,
  ]
    .filter(Boolean)
    .join(" · ");

export const createFlatsWork = (deps: FlatsWorkDeps) => {
  const { db, blob, queue, notifier, fetcher } = deps;

  const parserFor = (portal: Portal): PortalParser => {
    const parser = deps.parsers[portal];
    if (parser === undefined) {
      throw new PermanentJobError(`No parser for ${portal} yet`);
    }
    return parser;
  };

  const propertyUrl = (propertyId: string) => `${deps.publicUrl}/flats/properties/${propertyId}`;

  const alertIfTracked = async (change: ListingChange) => {
    const [property] = await db
      .select({ address: properties.address, status: properties.status })
      .from(properties)
      .where(and(eq(properties.id, change.propertyId), inArray(properties.status, [...TRACKED_STATUSES])));
    if (property === undefined) {
      return;
    }
    await notifier.send({
      title: property.address,
      message: describeChange(change),
      clickUrl: propertyUrl(change.propertyId),
      priority: change.availability === null ? "default" : "high",
      tag: change.propertyId,
    });
  };

  /** Announces a listing that survived its page's filters and is on the market, waiting to be triaged. */
  const announceArrival = async (listingId: string) => {
    const [arrival] = await db
      .select({
        id: properties.id,
        address: properties.address,
        price: properties.price,
        bedrooms: properties.bedrooms,
        sizeSqft: properties.sizeSqft,
      })
      .from(listings)
      .innerJoin(properties, eq(properties.id, listings.propertyId))
      .where(and(eq(listings.id, listingId), eq(properties.status, "new"), eq(properties.availability, "available")));
    if (arrival === undefined) {
      return;
    }
    await notifier.send({
      title: `New: ${arrival.address}`,
      message: describeArrival(arrival),
      clickUrl: propertyUrl(arrival.id),
      tag: arrival.id,
    });
  };

  const mirrorPhotos = defineJob({
    name: "flats.mirror-photos",
    payload: z.object({ listingId: z.uuid() }),
    timeoutMs: 3 * MINUTE,
    handle: async ({ listingId }, { signal }) => {
      const [listing] = await db.select({ parsed: listings.parsed }).from(listings).where(eq(listings.id, listingId));
      if (listing?.parsed == null) {
        return;
      }
      const wanted = [
        ...listing.parsed.photos
          .slice(0, MIRRORED_PHOTOS)
          .map((photo, position) => ({ kind: "photo" as const, position, photo })),
        ...listing.parsed.floorplans.map((photo, position) => ({ kind: "floorplan" as const, position, photo })),
      ];
      const stored = new Set(
        (await db.select({ sourceUrl: photos.sourceUrl }).from(photos).where(eq(photos.listingId, listingId))).map(
          (row) => row.sourceUrl,
        ),
      );
      for (const { kind, position, photo } of wanted.filter(({ photo }) => !stored.has(photo.url))) {
        const result = await fetcher.bytes(photo.url, signal);
        if (result.kind === "gone") {
          continue;
        }
        if (result.kind === "blocked") {
          throw new Error(`Blocked (${result.status}) downloading ${photo.url}`);
        }
        const id = Bun.randomUUIDv7();
        await blob.write(`photos/${id}`, new Blob([result.body.data]), result.body.contentType);
        await db
          .insert(photos)
          .values({
            id,
            listingId,
            kind,
            position,
            sourceUrl: photo.url,
            contentType: result.body.contentType,
            size: result.body.data.byteLength,
          })
          .onConflictDoNothing();
      }
    },
  });

  const computeCommutes = defineJob({
    name: "flats.commute",
    payload: z.object({ propertyId: z.uuid() }),
    timeoutMs: 2 * MINUTE,
    handle: async ({ propertyId }, { signal }) => {
      const planner = deps.planner;
      if (planner === null) {
        return;
      }
      const [property] = await db
        .select({ latitude: properties.latitude, longitude: properties.longitude })
        .from(properties)
        .where(and(eq(properties.id, propertyId), inPlay));
      if (property?.latitude == null || property.longitude == null) {
        return;
      }
      const from = { latitude: property.latitude, longitude: property.longitude };
      const untimed = await db
        .select({
          id: destinations.id,
          latitude: destinations.latitude,
          longitude: destinations.longitude,
          arriveBy: destinations.arriveBy,
        })
        .from(destinations)
        .leftJoin(commutes, and(eq(commutes.destinationId, destinations.id), eq(commutes.propertyId, propertyId)))
        .where(isNull(commutes.propertyId));
      for (const destination of untimed) {
        const minutes = await planner.fastestMinutes(
          from,
          { latitude: destination.latitude, longitude: destination.longitude },
          nextTuesday(deps.now(), destination.arriveBy),
          signal,
        );
        await db.insert(commutes).values({ propertyId, destinationId: destination.id, minutes }).onConflictDoNothing();
      }
    },
  });

  const parsePage = (parser: PortalParser, html: string, portalId: string): ParsedListing => {
    try {
      return parser.parseListing(html, portalId);
    } catch (error) {
      throw error instanceof ParseError ? new PermanentJobError(error.message) : error;
    }
  };

  /** Keeps the raw page for re-parsing, records what it says, and queues its photos. */
  const ingestPage = async (listingId: string, parsed: ParsedListing, html: string): Promise<ListingChange | null> => {
    const pageKey = `pages/${listingId}/${Bun.randomUUIDv7()}.html.gz`;
    await blob.write(pageKey, new Blob([Bun.gzipSync(html)]), "application/gzip");
    const change = await recordListingPage(db, listingId, { kind: "page", parsed, pageKey });
    await queue.enqueue(mirrorPhotos, { listingId }, { dedupeKey: listingId });
    const [listing] = await db
      .select({ propertyId: listings.propertyId })
      .from(listings)
      .where(eq(listings.id, listingId));
    if (listing !== undefined) {
      await queue.enqueue(computeCommutes, { propertyId: listing.propertyId }, { dedupeKey: listing.propertyId });
    }
    return change;
  };

  const fetchPage = async (parser: PortalParser, portalId: string, signal: AbortSignal) => {
    const result = await fetcher.text(parser.listingUrl(portalId), signal);
    if (result.kind === "blocked") {
      throw new Error(`Blocked (${result.status}) fetching ${parser.portal} listing ${portalId}`);
    }
    return result;
  };

  const fetchListing = defineJob({
    name: "flats.fetch-listing",
    /** `announce` notifies once the page shows the listing is worth triaging. */
    payload: z.object({ listingId: z.uuid(), announce: z.boolean().default(false) }),
    maxAttempts: 4,
    handle: async ({ listingId, announce }, { signal }) => {
      const [listing] = await db
        .select({ portal: listings.portal, portalId: listings.portalId })
        .from(listings)
        .where(eq(listings.id, listingId));
      if (listing === undefined) {
        return;
      }
      const parser = parserFor(listing.portal);
      const result = await fetchPage(parser, listing.portalId, signal);
      const change =
        result.kind === "gone"
          ? await recordListingPage(db, listingId, { kind: "gone" })
          : await ingestPage(listingId, parsePage(parser, result.body, listing.portalId), result.body);
      if (change !== null) {
        await alertIfTracked(change);
      }
      if (announce) {
        await announceArrival(listingId);
      }
    },
  });

  const addListing = defineJob({
    name: "flats.add-listing",
    payload: z.object({ portal: z.enum(PORTALS), portalId: z.string().min(1) }),
    maxAttempts: 4,
    handle: async ({ portal, portalId }, { signal }) => {
      const [known] = await db
        .select({ id: listings.id })
        .from(listings)
        .where(and(eq(listings.portal, portal), eq(listings.portalId, portalId)));
      if (known !== undefined) {
        await queue.enqueue(fetchListing, { listingId: known.id, announce: false }, { dedupeKey: known.id });
        return;
      }
      const parser = parserFor(portal);
      const result = await fetchPage(parser, portalId, signal);
      if (result.kind === "gone") {
        throw new PermanentJobError(`${portal} listing ${portalId} does not exist`);
      }
      const parsed = parsePage(parser, result.body, portalId);
      const outcome = await recordSearchHit(db, hitFromListing(parsed));
      await ingestPage(outcome.kind === "changed" ? outcome.change.listingId : outcome.listingId, parsed, result.body);
    },
  });

  const recordFailure = async (searchId: string, name: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const [search] = await db
      .update(searches)
      .set({
        lastPolledAt: sql`now()`,
        lastError: message,
        consecutiveFailures: sql`${searches.consecutiveFailures} + 1`,
      })
      .where(eq(searches.id, searchId))
      .returning({ failures: searches.consecutiveFailures });
    if (search !== undefined && search.failures >= MAX_CONSECUTIVE_FAILURES) {
      await db.update(searches).set({ enabled: false }).where(eq(searches.id, searchId));
      await notifier.send({
        title: `Search "${name}" paused`,
        message: `It failed ${search.failures} polls in a row: ${message}`,
        clickUrl: `${deps.publicUrl}/flats/searches`,
        priority: "high",
      });
    }
  };

  const pollSearch = defineJob({
    name: "flats.poll-search",
    payload: z.object({ searchId: z.uuid(), offset: z.number().int().nonnegative() }),
    maxAttempts: 1,
    handle: async ({ searchId, offset }, { signal }) => {
      const [search] = await db.select().from(searches).where(eq(searches.id, searchId));
      if (search === undefined || !search.enabled) {
        return;
      }
      try {
        const parser = parserFor(search.portal);
        const result = await fetcher.text(parser.newestFirst(search.url, offset), signal);
        if (result.kind !== "ok") {
          throw new Error(result.kind === "blocked" ? `Blocked with ${result.status}` : "Search page not found");
        }
        const hits = parser.parseSearch(result.body).filter((hit) => !hit.sharedOwnership);
        /** A search's first poll and the backfill's deeper pages turn up listings that were already there. */
        const announce = offset === 0 && search.lastSucceededAt !== null;
        for (const hit of hits) {
          const outcome = await recordSearchHit(db, hit);
          if (outcome.kind === "new") {
            await queue.enqueue(
              fetchListing,
              { listingId: outcome.listingId, announce },
              { dedupeKey: outcome.listingId },
            );
          } else if (outcome.kind === "changed") {
            await alertIfTracked(outcome.change);
          }
        }
        await db
          .update(searches)
          .set({ lastPolledAt: sql`now()`, lastSucceededAt: sql`now()`, consecutiveFailures: 0, lastError: null })
          .where(eq(searches.id, searchId));
      } catch (error) {
        await recordFailure(searchId, search.name, error);
      }
    },
  });

  const pollSearches = defineJob({
    name: "flats.poll-searches",
    payload: z.object({}),
    handle: async () => {
      if (!isActiveHour(deps.now())) {
        return;
      }
      const enabled = await db.select({ id: searches.id }).from(searches).where(eq(searches.enabled, true));
      for (const { id } of enabled) {
        await queue.enqueue(pollSearch, { searchId: id, offset: 0 }, { dedupeKey: `${id}:0` });
      }
    },
  });

  const refreshTracked = defineJob({
    name: "flats.refresh-tracked",
    payload: z.object({}),
    handle: async () => {
      const tracked = await db
        .select({ id: listings.id })
        .from(listings)
        .innerJoin(properties, eq(properties.id, listings.propertyId))
        .where(and(inArray(properties.status, [...TRACKED_STATUSES]), ne(listings.availability, "removed")))
        .orderBy(asc(listings.lastSeenAt));
      for (const { id } of tracked) {
        await queue.enqueue(fetchListing, { listingId: id, announce: false }, { dedupeKey: id });
      }
    },
  });

  /** Queues timing for every property still in play; each job only asks TfL about places it has not timed yet. */
  const enqueueCommutes = async () => {
    const timeable = await db.select({ id: properties.id }).from(properties).where(inPlay);
    for (const { id } of timeable) {
      await queue.enqueue(computeCommutes, { propertyId: id }, { dedupeKey: id });
    }
  };

  const sweepCommutes = defineJob({
    name: "flats.sweep-commutes",
    payload: z.object({}),
    handle: enqueueCommutes,
  });

  const jobs: readonly RegisteredJob[] = [
    pollSearches,
    pollSearch,
    fetchListing,
    addListing,
    mirrorPhotos,
    computeCommutes,
    sweepCommutes,
    refreshTracked,
  ];

  const schedules: readonly Schedule[] = [
    defineSchedule({
      name: "flats.poll-searches",
      everyMs: 10 * MINUTE,
      jitterMs: 3 * MINUTE,
      job: pollSearches,
      payload: {},
    }),
    defineSchedule({
      name: "flats.refresh-tracked",
      everyMs: 24 * HOUR,
      jitterMs: 2 * HOUR,
      job: refreshTracked,
      payload: {},
    }),
    defineSchedule({
      name: "flats.sweep-commutes",
      everyMs: 24 * HOUR,
      jitterMs: 2 * HOUR,
      job: sweepCommutes,
      payload: {},
    }),
  ];

  return {
    jobs,
    schedules,
    definitions: {
      pollSearches,
      pollSearch,
      fetchListing,
      addListing,
      mirrorPhotos,
      computeCommutes,
      sweepCommutes,
      refreshTracked,
    },
    /** Polls the first `pages` result pages of a new search, a minute apart, to seed it with current listings. */
    backfillSearch: async (searchId: string, pages: number) => {
      const start = deps.now().getTime();
      for (let page = 0; page < pages; page++) {
        await queue.enqueue(
          pollSearch,
          { searchId, offset: page * PAGE_SIZE },
          { dedupeKey: `${searchId}:${page * PAGE_SIZE}`, runAt: new Date(start + page * MINUTE) },
        );
      }
    },
    /** Times every property still in play to any place it has not been timed to yet, e.g. after adding a place. */
    timeCommutes: enqueueCommutes,
    /** Starts tracking a listing by its URL; resolves `false` when that listing is already being added. */
    addListing: (portal: Portal, portalId: string) =>
      queue.enqueue(addListing, { portal, portalId }, { dedupeKey: `${portal}:${portalId}` }),
  };
};

export type FlatsWork = ReturnType<typeof createFlatsWork>;
