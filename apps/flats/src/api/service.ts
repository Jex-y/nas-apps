import { type BlobStore, HttpError } from "@apps/core";
import { and, asc, between, desc, eq, gt, inArray, isNotNull, max, ne, sql } from "drizzle-orm";
import {
  type Commute,
  type CreateDestination,
  type CreateSearch,
  type CreateViewing,
  type CrimeCells,
  type CrimeSummary,
  type Destination,
  FLATS_API,
  MAX_VIEWING_PHOTO_BYTES,
  type MapBounds,
  type MapData,
  type PricePoint,
  type PropertyDetail,
  type PropertyStatus,
  type PropertySummary,
  type Question,
  type Requirements,
  type Search,
  type StoredAnswer,
  type Trial,
  type TrialRequest,
  type UpdateStatus,
  type Workbench,
} from "../contract";
import { breach, scoreProperty } from "../scoring";
import { CRIME_MONTHS, METRES_PER_DEGREE, monthsTo } from "./crime";
import type { FlatsDb } from "./db";
import type { FeatureExtractor } from "./extractor";
import { SHARED_OWNERSHIP_REASON } from "./ingest";
import type { Geocoder } from "./places";
import type { Portal, PortalParser } from "./portals/listing";
import { currentAnswers, type ListingState, listingState, unanswered } from "./questions";
import { latestTexts, readingsOf, recordReadings } from "./readings";
import { loadRequirements, saveRequirements } from "./requirements";
import {
  commutes,
  crime,
  crimeReports,
  crimeTiles,
  destinations,
  listings,
  photos,
  properties,
  searches,
  snapshots,
  viewingPhotos,
  viewings,
} from "./schema";
import type { FlatsWork } from "./work";

export type FlatsServiceDeps = {
  readonly db: FlatsDb;
  readonly blob: BlobStore;
  readonly work: FlatsWork;
  readonly parsers: readonly PortalParser[];
  readonly geocoder: Geocoder;
  /** `null` when no TypeSafe key is configured; drafts of the requirements then cannot be tried. */
  readonly extractor: FeatureExtractor | null;
};

/** A stored image's bytes, for a client that cannot follow a presigned URL. */
export type StoredImage = { readonly data: Uint8Array; readonly contentType: string };

export type AddedListing = { readonly portal: Portal; readonly portalId: string };

/** Pages polled when a search is added, so it starts with what is on the market now. */
const BACKFILL_PAGES = 3;
/** Crime cells are never finer than this, so a close zoom does not pinpoint one street's reports. */
const MIN_CELL_METRES = 120;
const CELLS_ACROSS = 120;

const photoPath = (id: string) => `${FLATS_API}/photos/${id}`;
const viewingPhotoPath = (id: string) => `${FLATS_API}/viewing-photos/${id}`;
const iso = (date: Date | null) => date?.toISOString() ?? null;

type PropertyRow = typeof properties.$inferSelect;

/** Keeps only the observations where price or availability changed. */
export const collapseHistory = (points: readonly PricePoint[]): PricePoint[] =>
  points.filter(
    (point, index) =>
      index === 0 || point.price !== points[index - 1]?.price || point.availability !== points[index - 1]?.availability,
  );

/**
 * The flat hunt, shared by the HTTP API and the MCP server. Fails with an {@link HttpError} saying why a change was
 * refused.
 */
export const createFlatsService = ({ db, blob, work, parsers, geocoder, extractor }: FlatsServiceDeps) => {
  /** Everything a ranking reads besides the questions, for the properties `ids`. */
  const rankingInputs = async (ids: readonly string[]) => {
    const timed = await db
      .select({
        propertyId: commutes.propertyId,
        destinationId: commutes.destinationId,
        name: destinations.name,
        minutes: commutes.minutes,
      })
      .from(commutes)
      .innerJoin(destinations, eq(destinations.id, commutes.destinationId))
      .where(inArray(commutes.propertyId, [...ids]))
      .orderBy(asc(destinations.createdAt));
    const texts = await latestTexts(db, ids);
    const read = await readingsOf(
      db,
      [...texts.values()].map((text) => text.fingerprint),
    );
    const counted = await db
      .select()
      .from(crime)
      .where(inArray(crime.propertyId, [...ids]));
    const [inbox] = await db
      .select({
        median: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${properties.price}::float8 / ${properties.sizeSqft})`,
      })
      .from(properties)
      .where(
        and(
          eq(properties.status, "new"),
          ne(properties.availability, "removed"),
          isNotNull(properties.price),
          gt(properties.sizeSqft, 0),
        ),
      );
    return {
      commutesOf: (propertyId: string): Commute[] =>
        timed
          .filter((commute) => commute.propertyId === propertyId)
          .map(({ destinationId, name, minutes }) => ({ destinationId, name, minutes })),
      /** The listing text Jev reads for the property; `undefined` until one of its pages has been read. */
      textOf: (propertyId: string) => texts.get(propertyId),
      storedAnswersOf: (propertyId: string): readonly StoredAnswer[] => {
        const text = texts.get(propertyId);
        return text === undefined ? [] : (read.get(text.fingerprint) ?? []);
      },
      crimeOf: (propertyId: string): CrimeSummary | null => {
        const row = counted.find((candidate) => candidate.propertyId === propertyId);
        if (row === undefined) {
          return null;
        }
        const { throughMonth, months, radiusMetres, byCategory } = row;
        const total = Object.values(byCategory).reduce((sum, count) => sum + count, 0);
        return { perMonth: total / months, months, throughMonth, radiusMetres, byCategory };
      },
      medianPricePerSqft: inbox?.median ?? null,
    };
  };

  /**
   * Judges one property by a draft of the requirements. Jev is asked only what it has not answered in the same words
   * about the same text, and its answers are kept, so saving the draft or trying it again asks nothing.
   */
  const trial = async ({ requirements: draft, propertyId }: TrialRequest, signal: AbortSignal): Promise<Trial> => {
    const row = await requireProperty(propertyId);
    const { textOf, commutesOf, storedAnswersOf, crimeOf, medianPricePerSqft } = await rankingInputs([row.id]);
    const text = textOf(row.id);
    if (text === undefined) {
      throw new HttpError(409, "That property's listing page has not been read yet");
    }
    const { parsed } = text;
    const stored = storedAnswersOf(row.id);
    const asking = unanswered(draft.questions, stored);
    const fresh =
      asking.length === 0
        ? []
        : await recordReadings(db, text, asking, await ask(listingState(parsed), asking, signal));
    const answered = currentAnswers(draft.questions, [...stored, ...fresh]);
    return {
      rejectedBy: row.sharedOwnership ? SHARED_OWNERSHIP_REASON : breach(row, draft.limits),
      ranking: scoreProperty(draft, {
        answers: answered,
        facts: { ...row, crime: crimeOf(row.id) },
        commutes: commutesOf(row.id),
        medianPricePerSqft,
      }),
      answers: draft.questions.map((question) => ({ key: question.key, answer: answered.get(question.key) ?? null })),
      asked: asking.length,
      listing: {
        propertyType: parsed.propertyType,
        keyFeatures: [...parsed.keyFeatures],
        description: parsed.description,
      },
    };
  };

  /** Jev's answers for a trial, with its refusals shown to whoever is editing the questions. */
  const ask = async (state: ListingState, questions: readonly Question[], signal: AbortSignal) => {
    if (extractor === null) {
      throw new HttpError(409, "Set TYPESAFE_API_KEY to try questions Jev has not answered yet");
    }
    try {
      return await extractor.answer(state, questions, signal);
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : String(error));
    }
  };

  type RankingInputs = Awaited<ReturnType<typeof rankingInputs>>;

  const summaries = async (rows: readonly PropertyRow[], inputs?: RankingInputs): Promise<PropertySummary[]> => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) {
      return [];
    }
    const adverts = await db
      .select({
        propertyId: listings.propertyId,
        portal: listings.portal,
        url: listings.url,
      })
      .from(listings)
      .where(inArray(listings.propertyId, ids));
    const covers = await db
      .selectDistinctOn([listings.propertyId], {
        propertyId: listings.propertyId,
        photoId: photos.id,
      })
      .from(photos)
      .innerJoin(listings, eq(listings.id, photos.listingId))
      .where(and(inArray(listings.propertyId, ids), eq(photos.kind, "photo")))
      .orderBy(listings.propertyId, asc(photos.position));
    const coverOf = new Map(covers.map((cover) => [cover.propertyId, photoPath(cover.photoId)]));
    const saved = await loadRequirements(db);
    const { commutesOf, storedAnswersOf, crimeOf, medianPricePerSqft } = inputs ?? (await rankingInputs(ids));
    const rankingOf = (row: PropertyRow) =>
      scoreProperty(saved, {
        answers: currentAnswers(saved.questions, storedAnswersOf(row.id)),
        facts: { ...row, crime: crimeOf(row.id) },
        commutes: commutesOf(row.id),
        medianPricePerSqft,
      });

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      address: row.address,
      postcode: row.postcode,
      price: row.price,
      priceQualifier: row.priceQualifier,
      availability: row.availability,
      propertyType: row.propertyType,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      sizeSqft: row.sizeSqft,
      tenure: row.tenure,
      leaseYearsRemaining: row.leaseYearsRemaining,
      annualServiceCharge: row.annualServiceCharge,
      annualGroundRent: row.annualGroundRent,
      councilTaxBand: row.councilTaxBand,
      sharedOwnership: row.sharedOwnership,
      auction: row.auction,
      thumbnailUrl: coverOf.get(row.id) ?? row.thumbnailUrl,
      firstSeenAt: row.firstSeenAt.toISOString(),
      listings: adverts.filter((advert) => advert.propertyId === row.id).map(({ portal, url }) => ({ portal, url })),
      commutes: commutesOf(row.id),
      crime: crimeOf(row.id),
      ranking: rankingOf(row),
    }));
  };

  /** Every property still listed, with Jev's stored answers, for the editor to rank by a draft in the browser. */
  const workbench = async (): Promise<Workbench> => {
    const rows = await db
      .select()
      .from(properties)
      .where(ne(properties.availability, "removed"))
      .orderBy(desc(properties.firstSeenAt));
    const ids = rows.map((row) => row.id);
    const inputs = await rankingInputs(ids);
    const summarised = await summaries(rows, inputs);
    return {
      medianPricePerSqft: inputs.medianPricePerSqft,
      properties: summarised.map((summary, index) => ({
        ...summary,
        rejectedReason: rows[index]?.rejectedReason ?? null,
        answers: [...inputs.storedAnswersOf(summary.id)],
        readable: inputs.textOf(summary.id) !== undefined,
      })),
    };
  };

  /** Every listed property that has a location, and every commute place, for the map. */
  const mapData = async (): Promise<MapData> => {
    const rows = await db
      .select()
      .from(properties)
      .where(
        and(ne(properties.availability, "removed"), isNotNull(properties.latitude), isNotNull(properties.longitude)),
      )
      .orderBy(desc(properties.firstSeenAt));
    const summarised = await summaries(rows);
    const places = await db.select().from(destinations).orderBy(asc(destinations.createdAt));
    return {
      properties: summarised.flatMap((summary, index) => {
        const row = rows[index];
        return row?.latitude == null || row.longitude == null
          ? []
          : [
              {
                id: summary.id,
                status: summary.status,
                address: summary.address,
                postcode: summary.postcode,
                price: summary.price,
                priceQualifier: summary.priceQualifier,
                bedrooms: summary.bedrooms,
                sizeSqft: summary.sizeSqft,
                thumbnailUrl: summary.thumbnailUrl,
                crime: summary.crime,
                ranking: summary.ranking,
                latitude: row.latitude,
                longitude: row.longitude,
              },
            ];
      }),
      places: places.map(({ id, name, latitude, longitude }) => ({ id, name, latitude, longitude })),
    };
  };

  /**
   * Street crime in `bounds` over the latest months stored, in square cells: about `CELLS_ACROSS` across the view,
   * but never finer than `MIN_CELL_METRES`, so the answer stays small at any zoom.
   */
  const crimeCells = async (bounds: MapBounds): Promise<CrimeCells> => {
    const spanMetres = (bounds.north - bounds.south) * METRES_PER_DEGREE;
    const cellMetres = Math.max(MIN_CELL_METRES, Math.round(spanMetres / CELLS_ACROSS));
    const [latest] = await db.select({ month: max(crimeTiles.month) }).from(crimeTiles);
    if (latest?.month == null) {
      return { throughMonth: null, months: CRIME_MONTHS, cellMetres, cells: [] };
    }
    const middle = (bounds.south + bounds.north) / 2;
    const tall = cellMetres / METRES_PER_DEGREE;
    const wide = cellMetres / (METRES_PER_DEGREE * Math.cos((middle * Math.PI) / 180));
    const row = sql<number>`floor(${crimeReports.latitude} / ${tall})`;
    const column = sql<number>`floor(${crimeReports.longitude} / ${wide})`;
    const cells = await db
      .select({ row, column, count: sql<number>`count(*)::int` })
      .from(crimeReports)
      .where(
        and(
          inArray(crimeReports.month, monthsTo(latest.month, CRIME_MONTHS)),
          between(crimeReports.latitude, bounds.south, bounds.north),
          between(crimeReports.longitude, bounds.west, bounds.east),
        ),
      )
      // By position: the cell size is bound once per mention, so Postgres cannot match the expressions themselves.
      .groupBy(sql`1`, sql`2`);
    return {
      throughMonth: latest.month,
      months: CRIME_MONTHS,
      cellMetres,
      cells: cells.map((cell) => ({
        latitude: (Number(cell.row) + 0.5) * tall,
        longitude: (Number(cell.column) + 0.5) * wide,
        count: cell.count,
      })),
    };
  };

  const requireProperty = async (id: string): Promise<PropertyRow> => {
    const [row] = await db.select().from(properties).where(eq(properties.id, id));
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    return row;
  };

  const detail = async (row: PropertyRow): Promise<PropertyDetail> => {
    const [summary] = await summaries([row]);
    if (summary === undefined) {
      throw new Error("summaries() dropped a row");
    }
    const adverts = await db
      .select({ id: listings.id, parsed: listings.parsed })
      .from(listings)
      .where(eq(listings.propertyId, row.id))
      .orderBy(desc(listings.parsedAt));
    const parsed = adverts.find((advert) => advert.parsed !== null)?.parsed ?? null;
    const listingIds = adverts.map((advert) => advert.id);

    const gallery =
      listingIds.length === 0
        ? []
        : await db
            .select({ id: photos.id, kind: photos.kind })
            .from(photos)
            .where(inArray(photos.listingId, listingIds))
            .orderBy(asc(photos.kind), asc(photos.position));
    const observations =
      listingIds.length === 0
        ? []
        : await db
            .select({
              observedAt: snapshots.observedAt,
              price: snapshots.price,
              availability: snapshots.availability,
            })
            .from(snapshots)
            .where(inArray(snapshots.listingId, listingIds))
            .orderBy(asc(snapshots.observedAt));
    const visits = await db.select().from(viewings).where(eq(viewings.propertyId, row.id)).orderBy(desc(viewings.at));
    const visitPhotos =
      visits.length === 0
        ? []
        : await db
            .select()
            .from(viewingPhotos)
            .where(
              inArray(
                viewingPhotos.viewingId,
                visits.map((visit) => visit.id),
              ),
            )
            .orderBy(asc(viewingPhotos.createdAt));

    return {
      ...summary,
      rejectedReason: row.rejectedReason,
      notes: row.notes,
      latitude: row.latitude,
      longitude: row.longitude,
      description: parsed?.description ?? "",
      keyFeatures: [...(parsed?.keyFeatures ?? [])],
      nearestStations: [...(parsed?.nearestStations ?? [])],
      agent: parsed?.agent ?? null,
      photos: gallery.map((photo) => ({
        id: photo.id,
        kind: photo.kind,
        url: photoPath(photo.id),
      })),
      history: collapseHistory(
        observations.map((point) => ({
          ...point,
          observedAt: point.observedAt.toISOString(),
        })),
      ),
      viewings: visits.map((visit) => ({
        id: visit.id,
        at: visit.at.toISOString(),
        rating: visit.rating,
        notes: visit.notes,
        createdBy: visit.createdBy,
        photos: visitPhotos
          .filter((photo) => photo.viewingId === visit.id)
          .map((photo) => ({
            id: photo.id,
            filename: photo.filename,
            url: viewingPhotoPath(photo.id),
          })),
      })),
    };
  };

  const toSearch = (row: typeof searches.$inferSelect): Search => ({
    id: row.id,
    name: row.name,
    portal: row.portal,
    url: row.url,
    enabled: row.enabled,
    lastPolledAt: iso(row.lastPolledAt),
    lastSucceededAt: iso(row.lastSucceededAt),
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
  });

  const toDestination = (row: typeof destinations.$inferSelect): Destination => ({
    id: row.id,
    name: row.name,
    postcode: row.postcode,
    arriveBy: row.arriveBy,
  });

  const notFound = () => new HttpError(404, "Not found");

  const requireViewingPhoto = async (id: string) => {
    const [photo] = await db.select().from(viewingPhotos).where(eq(viewingPhotos.id, id));
    if (photo === undefined) {
      throw notFound();
    }
    return photo;
  };

  const requirePhoto = async (id: string) => {
    const [photo] = await db
      .select({ id: photos.id, kind: photos.kind, position: photos.position, contentType: photos.contentType })
      .from(photos)
      .where(eq(photos.id, id));
    if (photo === undefined) {
      throw notFound();
    }
    return photo;
  };

  const image = async (key: string, contentType: string): Promise<StoredImage> => ({
    data: await blob.read(key),
    contentType,
  });

  return {
    /** Newest first, optionally only those with `status`. */
    properties: async (status: PropertyStatus | null): Promise<PropertySummary[]> =>
      summaries(
        await db
          .select()
          .from(properties)
          .where(status === null ? undefined : eq(properties.status, status))
          .orderBy(desc(properties.firstSeenAt)),
      ),

    property: async (id: string): Promise<PropertyDetail> => detail(await requireProperty(id)),

    setStatus: async (id: string, update: UpdateStatus): Promise<void> => {
      const row = await requireProperty(id);
      await db
        .update(properties)
        .set({
          status: update.status,
          rejectedReason: update.status === "rejected" ? update.reason : null,
        })
        .where(eq(properties.id, row.id));
    },

    setNotes: async (id: string, notes: string): Promise<void> => {
      const row = await requireProperty(id);
      await db.update(properties).set({ notes }).where(eq(properties.id, row.id));
    },

    addViewing: async (propertyId: string, input: CreateViewing, createdBy: string): Promise<void> => {
      const row = await requireProperty(propertyId);
      await db.insert(viewings).values({
        propertyId: row.id,
        at: new Date(input.at),
        rating: input.rating,
        notes: input.notes,
        createdBy,
      });
    },

    deleteViewing: async (id: string): Promise<void> => {
      const doomed = await db
        .select({ id: viewingPhotos.id })
        .from(viewingPhotos)
        .where(eq(viewingPhotos.viewingId, id));
      const deleted = await db.delete(viewings).where(eq(viewings.id, id)).returning({ id: viewings.id });
      if (deleted.length === 0) {
        throw notFound();
      }
      await Promise.all(doomed.map((photo) => blob.delete(`viewing-photos/${photo.id}`)));
    },

    addViewingPhoto: async (viewingId: string, file: File): Promise<void> => {
      const [viewing] = await db.select({ id: viewings.id }).from(viewings).where(eq(viewings.id, viewingId));
      if (viewing === undefined) {
        throw notFound();
      }
      if (file.size > MAX_VIEWING_PHOTO_BYTES) {
        throw new HttpError(413, "Photo too large");
      }
      const id = Bun.randomUUIDv7();
      const contentType = file.type || "application/octet-stream";
      await blob.write(`viewing-photos/${id}`, file, contentType);
      try {
        await db.insert(viewingPhotos).values({
          id,
          viewingId: viewing.id,
          filename: file.name || "photo",
          contentType,
          size: file.size,
        });
      } catch (error) {
        await blob.delete(`viewing-photos/${id}`);
        throw error;
      }
    },

    viewingPhotoUrl: async (id: string): Promise<string> => {
      const photo = await requireViewingPhoto(id);
      return blob.downloadUrl(`viewing-photos/${photo.id}`, { filename: photo.filename });
    },

    viewingPhoto: async (id: string): Promise<StoredImage> => {
      const photo = await requireViewingPhoto(id);
      return image(`viewing-photos/${photo.id}`, photo.contentType);
    },

    deleteViewingPhoto: async (id: string): Promise<void> => {
      const deleted = await db
        .delete(viewingPhotos)
        .where(eq(viewingPhotos.id, id))
        .returning({ id: viewingPhotos.id });
      if (deleted.length === 0) {
        throw notFound();
      }
      await blob.delete(`viewing-photos/${id}`);
    },

    photoUrl: async (id: string): Promise<string> => {
      const photo = await requirePhoto(id);
      return blob.downloadUrl(`photos/${photo.id}`, {
        filename: `${photo.kind}-${photo.position + 1}.jpg`,
        expiresInSeconds: 3600,
      });
    },

    photo: async (id: string): Promise<StoredImage> => {
      const photo = await requirePhoto(id);
      return image(`photos/${photo.id}`, photo.contentType);
    },

    searches: async (): Promise<Search[]> =>
      (await db.select().from(searches).orderBy(asc(searches.createdAt))).map(toSearch),

    /** Saves a search and polls its first pages, so it starts with what is on the market now. */
    createSearch: async (input: CreateSearch): Promise<Search> => {
      const parser = parsers.find((candidate) => {
        try {
          candidate.newestFirst(input.url, 0);
          return true;
        } catch {
          return false;
        }
      });
      if (parser === undefined) {
        throw new HttpError(400, "That is not a search URL from a supported portal");
      }
      const [created] = await db
        .insert(searches)
        .values({ name: input.name, portal: parser.portal, url: input.url })
        .onConflictDoNothing()
        .returning();
      if (created === undefined) {
        throw new HttpError(409, "That search is already saved");
      }
      await work.backfillSearch(created.id, BACKFILL_PAGES);
      return toSearch(created);
    },

    /** Re-enabling a search forgives its failures. */
    setSearchEnabled: async (id: string, enabled: boolean): Promise<Search> => {
      const [updated] = await db
        .update(searches)
        .set(enabled ? { enabled, consecutiveFailures: 0 } : { enabled })
        .where(eq(searches.id, id))
        .returning();
      if (updated === undefined) {
        throw notFound();
      }
      return toSearch(updated);
    },

    deleteSearch: async (id: string): Promise<void> => {
      const deleted = await db.delete(searches).where(eq(searches.id, id)).returning({ id: searches.id });
      if (deleted.length === 0) {
        throw notFound();
      }
    },

    /** Queues a listing to be fetched and read; it appears among the properties once it has been. */
    addListing: async (url: string): Promise<AddedListing> => {
      for (const parser of parsers) {
        const portalId = parser.portalIdFromUrl(url);
        if (portalId !== null) {
          await work.addListing(parser.portal, portalId);
          return { portal: parser.portal, portalId };
        }
      }
      throw new HttpError(400, "That is not a listing URL from a supported portal");
    },

    requirements: (): Promise<Requirements> => loadRequirements(db),

    /** Saves the requirements and re-judges the untriaged properties by them. */
    saveRequirements: async (document: Requirements): Promise<Requirements> => {
      await saveRequirements(db, document);
      await work.applyRequirements();
      return document;
    },

    trial,

    workbench,

    mapData,

    crimeCells,

    destinations: async (): Promise<Destination[]> =>
      (await db.select().from(destinations).orderBy(asc(destinations.createdAt))).map(toDestination),

    /** Adds a place and times every property's commute to it. */
    createDestination: async (input: CreateDestination): Promise<Destination> => {
      const place = await geocoder.postcode(input.postcode);
      if (place === null) {
        throw new HttpError(400, `${input.postcode} is not a UK postcode`);
      }
      const [created] = await db
        .insert(destinations)
        .values({ name: input.name, postcode: place.postcode, arriveBy: input.arriveBy, ...place.location })
        .returning();
      if (created === undefined) {
        throw new Error("INSERT … RETURNING produced no destination");
      }
      await work.timeCommutes();
      return toDestination(created);
    },

    deleteDestination: async (id: string): Promise<void> => {
      const deleted = await db.delete(destinations).where(eq(destinations.id, id)).returning({ id: destinations.id });
      if (deleted.length === 0) {
        throw notFound();
      }
    },
  };
};

export type FlatsService = ReturnType<typeof createFlatsService>;
