import type { BlobStore, JobQueue, Notifier, RegisteredJob, Schedule } from "@apps/core";
import { defineJob, defineSchedule, PermanentJobError } from "@apps/core";
import { and, asc, between, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { type PastSale, TRACKED_STATUSES } from "../contract";
import { breach, exclusion } from "../scoring";
import {
  CRIME_MONTHS,
  CRIME_RADIUS_METRES,
  type CrimeRecords,
  type CrimeReport,
  degreesAcross,
  METRES_PER_DEGREE,
  monthsTo,
  tilesAround,
} from "./crime";
import type { FlatsDb } from "./db";
import type { FeatureExtractor } from "./extractor";
import type { Fetcher } from "./fetcher";
import { hitFromListing, type ListingChange, recordListingPage, recordSearchHit } from "./ingest";
import { type Coordinates, type JourneyPlanner, nextTuesday } from "./places";
import { type ParsedListing, ParseError, PORTALS, type Portal, type PortalParser } from "./portals/listing";
import { currentAnswers, listingState, unanswered } from "./questions";
import { latestTexts, readingsOf, recordReadings } from "./readings";
import { loadRequirements } from "./requirements";
import {
  commutes,
  crime,
  crimeReports,
  crimeTiles,
  destinations,
  listings,
  photos,
  properties,
  saleHistories,
  searches,
  snapshots,
} from "./schema";

export type FlatsWorkDeps = {
  readonly db: FlatsDb;
  readonly blob: BlobStore;
  readonly queue: JobQueue;
  readonly notifier: Notifier;
  readonly fetcher: Fetcher;
  /** `null` when no TfL key is configured; commutes are then left uncomputed. */
  readonly planner: JourneyPlanner | null;
  readonly crime: CrimeRecords;
  /** `null` when no TypeSafe key is configured; listings are then left unread. */
  readonly extractor: FeatureExtractor | null;
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

/** Properties worth timing and reading: not rejected and still advertised. */
const inPlay = and(ne(properties.status, "rejected"), ne(properties.availability, "removed"));

/** What `read` parses; a portal whose pages changed shape fails the job for good, since retrying cannot help. */
const unlessChanged = <T>(read: () => T): T => {
  try {
    return read();
  } catch (error) {
    throw error instanceof ParseError ? new PermanentJobError(error.message) : error;
  }
};

/** One of each sale, newest first: two listings of one property report the same sales. */
const newestFirst = (sales: readonly PastSale[]): PastSale[] =>
  [...new Map(sales.map((sale) => [`${sale.year} ${sale.price}`, sale])).values()].toSorted(
    (a, b) => b.year - a.year || b.price - a.price,
  );

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

  /** Announces a property that survived the limits and Jev's exclusions and is on the market, waiting to be triaged. */
  const announceArrival = async (propertyId: string) => {
    const [arrival] = await db
      .select({
        id: properties.id,
        address: properties.address,
        price: properties.price,
        bedrooms: properties.bedrooms,
        sizeSqft: properties.sizeSqft,
      })
      .from(properties)
      .where(
        and(eq(properties.id, propertyId), eq(properties.status, "new"), eq(properties.availability, "available")),
      );
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

  /** Crimes by category recorded in `months` within `radiusMetres` of `at`, from the reports stored. */
  const crimeNear = async (at: Coordinates, radiusMetres: number, months: readonly string[]) => {
    const span = degreesAcross(at.latitude, radiusMetres);
    const east = METRES_PER_DEGREE * Math.cos((at.latitude * Math.PI) / 180);
    const counts = await db
      .select({ category: crimeReports.category, count: sql<number>`count(*)::int` })
      .from(crimeReports)
      .where(
        and(
          inArray(crimeReports.month, [...months]),
          between(crimeReports.latitude, at.latitude - span.latitude, at.latitude + span.latitude),
          between(crimeReports.longitude, at.longitude - span.longitude, at.longitude + span.longitude),
          sql`power((${crimeReports.latitude} - ${at.latitude}) * ${METRES_PER_DEGREE}, 2)
            + power((${crimeReports.longitude} - ${at.longitude}) * ${east}, 2) <= ${radiusMetres ** 2}`,
        ),
      )
      .groupBy(crimeReports.category);
    return Object.fromEntries(counts.map(({ category, count }) => [category, count]));
  };

  /**
   * Counts street crime around the property over the latest months the police have published. Each tile of the
   * crime grid is fetched once a month and its reports kept, so neighbours share them; a property already counted to
   * the latest month is left alone, so a sweep costs nothing until a new month is out.
   */
  const countCrime = defineJob({
    name: "flats.count-crime",
    payload: z.object({ propertyId: z.uuid() }),
    // Each area and month is saved as it arrives, so a job that times out waiting its turn resumes where it stopped.
    timeoutMs: 4 * MINUTE,
    handle: async ({ propertyId }, { signal }) => {
      const [property] = await db
        .select({ latitude: properties.latitude, longitude: properties.longitude, counted: crime.throughMonth })
        .from(properties)
        .leftJoin(crime, eq(crime.propertyId, properties.id))
        .where(and(eq(properties.id, propertyId), inPlay));
      if (property?.latitude == null || property.longitude == null) {
        return;
      }
      const latest = await deps.crime.latestMonth(signal);
      if (property.counted === latest) {
        return;
      }
      const at = { latitude: property.latitude, longitude: property.longitude };
      const months = monthsTo(latest, CRIME_MONTHS);
      const tiles = tilesAround(at, CRIME_RADIUS_METRES);
      const fetched = await db
        .select({ tile: crimeTiles.tile, month: crimeTiles.month })
        .from(crimeTiles)
        .where(
          and(
            inArray(
              crimeTiles.tile,
              tiles.map((tile) => tile.key),
            ),
            inArray(crimeTiles.month, months),
          ),
        );
      const done = new Set(fetched.map(({ tile, month }) => `${tile} ${month}`));
      // A tile's missing months are saved together, so a job that times out resumes at the next tile.
      for (const tile of tiles) {
        const missing = months.filter((month) => !done.has(`${tile.key} ${month}`));
        if (missing.length === 0) {
          continue;
        }
        const reports: CrimeReport[] = [];
        for (const month of missing) {
          reports.push(...(await deps.crime.inArea(tile.bounds, month, signal)));
        }
        await db.transaction(async (tx) => {
          if (reports.length > 0) {
            await tx.insert(crimeReports).values(reports).onConflictDoNothing();
          }
          await tx
            .insert(crimeTiles)
            .values(missing.map((month) => ({ tile: tile.key, month })))
            .onConflictDoNothing();
        });
      }
      const counted = {
        throughMonth: latest,
        months: CRIME_MONTHS,
        radiusMetres: CRIME_RADIUS_METRES,
        byCategory: await crimeNear(at, CRIME_RADIUS_METRES, months),
      };
      await db
        .insert(crime)
        .values({ propertyId, ...counted })
        .onConflictDoUpdate({ target: crime.propertyId, set: { ...counted, countedAt: sql`now()` } });
    },
  });

  /**
   * Looks up what the property sold for before, once: the portal serves it apart from the listing page, keyed by an
   * address the stored page names. A property whose listings name no address is recorded as having no known sales.
   */
  const fetchSales = defineJob({
    name: "flats.fetch-sales",
    payload: z.object({ propertyId: z.uuid() }),
    handle: async ({ propertyId }, { signal }) => {
      const [fetched] = await db
        .select({ propertyId: saleHistories.propertyId })
        .from(saleHistories)
        .where(eq(saleHistories.propertyId, propertyId));
      if (fetched !== undefined) {
        return;
      }
      const pages = await db
        .selectDistinctOn([listings.id], { portal: listings.portal, pageKey: snapshots.pageKey })
        .from(snapshots)
        .innerJoin(listings, eq(listings.id, snapshots.listingId))
        .where(and(eq(listings.propertyId, propertyId), isNotNull(snapshots.pageKey)))
        .orderBy(listings.id, desc(snapshots.observedAt));
      if (pages.length === 0) {
        return;
      }
      const sales: PastSale[] = [];
      for (const { portal, pageKey } of pages) {
        const parser = parserFor(portal);
        const url =
          pageKey === null
            ? null
            : parser.saleHistoryUrl(new TextDecoder().decode(Bun.gunzipSync(await blob.read(pageKey))));
        if (url === null) {
          continue;
        }
        const result = await fetcher.text(url, signal);
        if (result.kind === "blocked") {
          throw new Error(`Blocked (${result.status}) fetching the sale history of ${propertyId}`);
        }
        if (result.kind === "ok") {
          sales.push(...unlessChanged(() => parser.parseSaleHistory(result.body)));
        }
      }
      await db
        .insert(saleHistories)
        .values({ propertyId, sales: newestFirst(sales) })
        .onConflictDoNothing();
    },
  });

  /**
   * Asks Jev whatever the current questions have no answer for in the listing's current text, and rejects the property
   * if it is now excluded. A page whose text changed is a new text, so it is read afresh.
   */
  const read = async (propertyId: string, signal: AbortSignal) => {
    const extractor = deps.extractor;
    if (extractor === null) {
      return;
    }
    const [playing] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), inPlay));
    const text = playing === undefined ? undefined : (await latestTexts(db, [propertyId])).get(propertyId);
    if (text === undefined) {
      return;
    }
    const { questions } = await loadRequirements(db);
    const stored = (await readingsOf(db, [text.fingerprint])).get(text.fingerprint) ?? [];
    const asking = unanswered(questions, stored);
    if (asking.length === 0) {
      return;
    }
    const extraction = await extractor.answer(listingState(text.parsed), asking, signal);
    const fresh = await recordReadings(db, text, asking, extraction);
    const rejectedReason = exclusion(questions, currentAnswers(questions, [...stored, ...fresh]));
    if (rejectedReason !== null) {
      await db
        .update(properties)
        .set({ status: "rejected", rejectedReason })
        .where(and(eq(properties.id, propertyId), eq(properties.status, "new")));
    }
  };

  const readListing = defineJob({
    name: "flats.read-listing",
    /** `announce` notifies once the property is read, if it is still worth triaging. */
    payload: z.object({ propertyId: z.uuid(), announce: z.boolean().default(false) }),
    handle: async ({ propertyId, announce }, { signal }) => {
      await read(propertyId, signal);
      if (announce) {
        await announceArrival(propertyId);
      }
    },
  });

  const parsePage = (parser: PortalParser, html: string, portalId: string): ParsedListing =>
    unlessChanged(() => parser.parseListing(html, portalId));

  /**
   * Keeps the raw page for re-parsing, records what it says, and queues its photos, commutes and reading; `announce`
   * notifies once it has been read.
   */
  const ingestPage = async (
    listingId: string,
    parsed: ParsedListing,
    html: string,
    announce: boolean,
  ): Promise<ListingChange | null> => {
    const pageKey = `pages/${listingId}/${Bun.randomUUIDv7()}.html.gz`;
    await blob.write(pageKey, new Blob([Bun.gzipSync(html)]), "application/gzip");
    const { limits } = await loadRequirements(db);
    const change = await recordListingPage(db, listingId, { kind: "page", parsed, pageKey, limits });
    await queue.enqueue(mirrorPhotos, { listingId }, { dedupeKey: listingId });
    const [listing] = await db
      .select({ propertyId: listings.propertyId })
      .from(listings)
      .where(eq(listings.id, listingId));
    if (listing !== undefined) {
      await queue.enqueue(computeCommutes, { propertyId: listing.propertyId }, { dedupeKey: listing.propertyId });
      await queue.enqueue(countCrime, { propertyId: listing.propertyId }, { dedupeKey: listing.propertyId });
      await queue.enqueue(fetchSales, { propertyId: listing.propertyId }, { dedupeKey: listing.propertyId });
      // A distinct key, so a sweep's pending read of the same property cannot swallow the announcement.
      await queue.enqueue(
        readListing,
        { propertyId: listing.propertyId, announce },
        { dedupeKey: announce ? `${listing.propertyId}:announce` : listing.propertyId },
      );
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
    /** `announce` notifies once the listing is read, if it is still worth triaging. */
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
          : await ingestPage(listingId, parsePage(parser, result.body, listing.portalId), result.body, announce);
      if (change !== null) {
        await alertIfTracked(change);
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
      await ingestPage(
        outcome.kind === "changed" ? outcome.change.listingId : outcome.listingId,
        parsed,
        result.body,
        false,
      );
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

  const sweepCrime = defineJob({
    name: "flats.sweep-crime",
    payload: z.object({}),
    handle: async () => {
      const countable = await db.select({ id: properties.id }).from(properties).where(inPlay);
      for (const { id } of countable) {
        await queue.enqueue(countCrime, { propertyId: id }, { dedupeKey: id });
      }
    },
  });

  /** Each job only asks the portal about a property it has not asked about before. */
  const sweepSales = defineJob({
    name: "flats.sweep-sales",
    payload: z.object({}),
    handle: async () => {
      const unasked = await db
        .select({ id: properties.id })
        .from(properties)
        .leftJoin(saleHistories, eq(saleHistories.propertyId, properties.id))
        .where(and(inPlay, isNull(saleHistories.propertyId)));
      for (const { id } of unasked) {
        await queue.enqueue(fetchSales, { propertyId: id }, { dedupeKey: id });
      }
    },
  });

  /** Reads every property still in play, e.g. after a question is reworded or TypeSafe is configured. */
  /** Queues a read of every property still in play; each only asks Jev what the current questions lack. */
  const enqueueReadings = async () => {
    const readable = await db.select({ id: properties.id }).from(properties).where(inPlay);
    for (const { id } of readable) {
      await queue.enqueue(readListing, { propertyId: id, announce: false }, { dedupeKey: id });
    }
  };

  const sweepReadings = defineJob({
    name: "flats.sweep-readings",
    payload: z.object({}),
    handle: enqueueReadings,
  });

  const jobs: readonly RegisteredJob[] = [
    pollSearches,
    pollSearch,
    fetchListing,
    addListing,
    mirrorPhotos,
    computeCommutes,
    sweepCommutes,
    countCrime,
    sweepCrime,
    fetchSales,
    sweepSales,
    readListing,
    sweepReadings,
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
    defineSchedule({
      name: "flats.sweep-crime",
      everyMs: 24 * HOUR,
      jitterMs: 2 * HOUR,
      job: sweepCrime,
      payload: {},
    }),
    defineSchedule({
      name: "flats.sweep-sales",
      everyMs: 24 * HOUR,
      jitterMs: 2 * HOUR,
      job: sweepSales,
      payload: {},
    }),
    defineSchedule({
      name: "flats.sweep-readings",
      everyMs: 24 * HOUR,
      jitterMs: 2 * HOUR,
      job: sweepReadings,
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
      countCrime,
      sweepCrime,
      fetchSales,
      sweepSales,
      readListing,
      sweepReadings,
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
    /** Rejects untriaged properties the saved limits now rule out, and reads the rest against the saved questions. */
    applyRequirements: async () => {
      const { limits } = await loadRequirements(db);
      const untriaged = await db
        .select({
          id: properties.id,
          sizeSqft: properties.sizeSqft,
          annualServiceCharge: properties.annualServiceCharge,
          leaseYearsRemaining: properties.leaseYearsRemaining,
        })
        .from(properties)
        .where(eq(properties.status, "new"));
      for (const property of untriaged) {
        const rejectedReason = breach(property, limits);
        if (rejectedReason !== null) {
          await db
            .update(properties)
            .set({ status: "rejected", rejectedReason })
            .where(and(eq(properties.id, property.id), eq(properties.status, "new")));
        }
      }
      await enqueueReadings();
    },
    /** Starts tracking a listing by its URL; resolves `false` when that listing is already being added. */
    addListing: (portal: Portal, portalId: string) =>
      queue.enqueue(addListing, { portal, portalId }, { dedupeKey: `${portal}:${portalId}` }),
  };
};

export type FlatsWork = ReturnType<typeof createFlatsWork>;
