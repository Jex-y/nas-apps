import type { BlobStore, JobQueue, Notifier, RegisteredJob, Schedule } from "@nas/core";
import { defineJob, defineSchedule, PermanentJobError } from "@nas/core";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { TRACKED_STATUSES } from "../contract";
import type { FlatsDb } from "./db";
import type { Fetcher } from "./fetcher";
import { type ListingChange, recordListingPage, recordSearchHit } from "./ingest";
import { ParseError, type Portal, type PortalParser } from "./portals/listing";
import { listings, photos, properties, searches } from "./schema";

export type FlatsWorkDeps = {
  readonly db: FlatsDb;
  readonly blob: BlobStore;
  readonly queue: JobQueue;
  readonly notifier: Notifier;
  readonly fetcher: Fetcher;
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

const formatPrice = (price: number | null) => (price === null ? "POA" : `£${price.toLocaleString("en-GB")}`);

const describeChange = (change: ListingChange): string =>
  [
    change.price && `Price ${formatPrice(change.price.from)} → ${formatPrice(change.price.to)}`,
    change.availability && `Now ${change.availability.to.replace("_", " ")}`,
  ]
    .filter(Boolean)
    .join(". ");

export const createFlatsWork = (deps: FlatsWorkDeps) => {
  const { db, blob, queue, notifier, fetcher } = deps;

  const parserFor = (portal: Portal): PortalParser => {
    const parser = deps.parsers[portal];
    if (parser === undefined) {
      throw new PermanentJobError(`No parser for ${portal} yet`);
    }
    return parser;
  };

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
      clickUrl: `${deps.publicUrl}/flats/properties/${change.propertyId}`,
      priority: change.availability === null ? "default" : "high",
      tags: [
        change.price !== null && (change.price.to ?? 0) < (change.price.from ?? 0)
          ? "chart_with_downwards_trend"
          : "house",
      ],
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

  const fetchListing = defineJob({
    name: "flats.fetch-listing",
    payload: z.object({ listingId: z.uuid() }),
    maxAttempts: 4,
    handle: async ({ listingId }, { signal }) => {
      const [listing] = await db
        .select({ portal: listings.portal, portalId: listings.portalId })
        .from(listings)
        .where(eq(listings.id, listingId));
      if (listing === undefined) {
        return;
      }
      const parser = parserFor(listing.portal);
      const result = await fetcher.text(parser.listingUrl(listing.portalId), signal);
      if (result.kind === "blocked") {
        throw new Error(`Blocked (${result.status}) fetching ${listing.portal} listing ${listing.portalId}`);
      }

      let change: ListingChange | null;
      if (result.kind === "gone") {
        change = await recordListingPage(db, listingId, { kind: "gone" });
      } else {
        let parsed: ReturnType<PortalParser["parseListing"]>;
        try {
          parsed = parser.parseListing(result.body, listing.portalId);
        } catch (error) {
          throw error instanceof ParseError ? new PermanentJobError(error.message) : error;
        }
        const pageKey = `pages/${listingId}/${Bun.randomUUIDv7()}.html.gz`;
        await blob.write(pageKey, new Blob([Bun.gzipSync(result.body)]), "application/gzip");
        change = await recordListingPage(db, listingId, { kind: "page", parsed, pageKey });
        await queue.enqueue(mirrorPhotos, { listingId }, { dedupeKey: listingId });
      }
      if (change !== null) {
        await alertIfTracked(change);
      }
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
        tags: ["warning"],
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
        const hits = parser.parseSearch(result.body);
        for (const hit of hits) {
          const outcome = await recordSearchHit(db, hit);
          if (outcome.kind === "new") {
            await queue.enqueue(fetchListing, { listingId: outcome.listingId }, { dedupeKey: outcome.listingId });
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
        await queue.enqueue(fetchListing, { listingId: id }, { dedupeKey: id });
      }
    },
  });

  const jobs: readonly RegisteredJob[] = [pollSearches, pollSearch, fetchListing, mirrorPhotos, refreshTracked];

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
  ];

  return {
    jobs,
    schedules,
    definitions: { pollSearches, pollSearch, fetchListing, mirrorPhotos, refreshTracked },
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
    /** Queues a (re)fetch of one listing page; resolves `false` when one is already queued. */
    fetchListing: (listingId: string) => queue.enqueue(fetchListing, { listingId }, { dedupeKey: listingId }),
  };
};

export type FlatsWork = ReturnType<typeof createFlatsWork>;
