import {
  type BlobStore,
  defineRoutes,
  HttpError,
  type IdentityMode,
  parseBody,
  parseParam,
  resolveViewer,
} from "@apps/core";
import { and, asc, desc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AddListing,
  type Commute,
  CreateDestination,
  CreateSearch,
  CreateViewing,
  type Destination,
  MAX_VIEWING_PHOTO_BYTES,
  PROPERTY_STATUSES,
  type PricePoint,
  type PropertyDetail,
  type PropertySummary,
  type Question,
  Requirements,
  type Search,
  type Trial,
  TrialRequest,
  UpdateNotes,
  UpdateSearch,
  UpdateStatus,
} from "../contract";
import type { FlatsDb } from "./db";
import type { FeatureExtractor } from "./extractor";
import { SHARED_OWNERSHIP_REASON } from "./ingest";
import type { Geocoder } from "./places";
import type { PortalParser } from "./portals/listing";
import { currentAnswers, type ListingState, listingState, unanswered } from "./questions";
import { scoreProperty } from "./ranking";
import { breach, loadRequirements, saveRequirements } from "./requirements";
import {
  answers,
  commutes,
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

export type FlatsRoutesDeps = {
  readonly db: FlatsDb;
  readonly blob: BlobStore;
  readonly identity: IdentityMode;
  readonly work: FlatsWork;
  readonly parsers: readonly PortalParser[];
  readonly geocoder: Geocoder;
  /** `null` when no TypeSafe key is configured; drafts of the requirements then cannot be tried. */
  readonly extractor: FeatureExtractor | null;
};

const API = "/flats/api";
/** Pages polled when a search is added, so it starts with what is on the market now. */
const BACKFILL_PAGES = 3;

const photoPath = (id: string) => `${API}/photos/${id}`;
const viewingPhotoPath = (id: string) => `${API}/viewing-photos/${id}`;
const iso = (date: Date | null) => date?.toISOString() ?? null;

type PropertyRow = typeof properties.$inferSelect;

/** Keeps only the observations where price or availability changed. */
export const collapseHistory = (points: readonly PricePoint[]): PricePoint[] =>
  points.filter(
    (point, index) =>
      index === 0 || point.price !== points[index - 1]?.price || point.availability !== points[index - 1]?.availability,
  );

const pricePerSqft = (row: Pick<PropertyRow, "price" | "sizeSqft">): number | null =>
  row.price !== null && row.sizeSqft ? row.price / row.sizeSqft : null;

export const createFlatsRoutes = ({ db, blob, identity, work, parsers, geocoder, extractor }: FlatsRoutesDeps) => {
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
    const stored = await db
      .select({
        propertyId: answers.propertyId,
        questionKey: answers.questionKey,
        fingerprint: answers.fingerprint,
        answer: answers.answer,
      })
      .from(answers)
      .where(inArray(answers.propertyId, [...ids]));
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
      storedAnswersOf: (propertyId: string) => stored.filter((answer) => answer.propertyId === propertyId),
      medianPricePerSqft: inbox?.median ?? null,
    };
  };

  /** Judges one property by a draft of the requirements; Jev is asked only what it has not answered in the same words. */
  const trial = async ({ requirements: draft, propertyId }: TrialRequest, signal: AbortSignal): Promise<Trial> => {
    const row = await requireProperty(propertyId);
    const [advert] = await db
      .select({ parsed: listings.parsed })
      .from(listings)
      .where(and(eq(listings.propertyId, row.id), isNotNull(listings.parsed)))
      .orderBy(desc(listings.parsedAt))
      .limit(1);
    const parsed = advert?.parsed;
    if (parsed == null) {
      throw new HttpError(409, "That property's listing page has not been read yet");
    }
    const { commutesOf, storedAnswersOf, medianPricePerSqft } = await rankingInputs([row.id]);
    const stored = storedAnswersOf(row.id);
    const asking = unanswered(draft.questions, stored);
    const fresh = asking.length === 0 ? new Map() : (await ask(listingState(parsed), asking, signal)).answers;
    const answered = new Map([...currentAnswers(draft.questions, stored), ...fresh]);
    return {
      rejectedBy: row.sharedOwnership ? SHARED_OWNERSHIP_REASON : breach(row, draft.limits),
      ranking: scoreProperty(draft.questions, {
        answers: answered,
        commutes: commutesOf(row.id),
        pricePerSqft: pricePerSqft(row),
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

  const summaries = async (rows: readonly PropertyRow[]): Promise<PropertySummary[]> => {
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
    const { questions } = await loadRequirements(db);
    const { commutesOf, storedAnswersOf, medianPricePerSqft } = await rankingInputs(ids);
    const rankingOf = (row: PropertyRow) =>
      scoreProperty(questions, {
        answers: currentAnswers(questions, storedAnswersOf(row.id)),
        commutes: commutesOf(row.id),
        pricePerSqft: pricePerSqft(row),
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
      ranking: rankingOf(row),
    }));
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

  const redirectTo = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

  return defineRoutes({
    "/flats/api/properties": {
      GET: async (request) => {
        resolveViewer(identity, request);
        const status = new URL(request.url).searchParams.get("status");
        const filter =
          status === null ? undefined : eq(properties.status, parseParam(status, z.enum(PROPERTY_STATUSES)));
        const rows = await db.select().from(properties).where(filter).orderBy(desc(properties.firstSeenAt));
        return Response.json(await summaries(rows));
      },
    },
    "/flats/api/properties/:id": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await detail(await requireProperty(parseParam(request.params.id, z.uuid()))));
      },
    },
    "/flats/api/properties/:id/status": {
      PUT: async (request) => {
        resolveViewer(identity, request);
        const row = await requireProperty(parseParam(request.params.id, z.uuid()));
        const update = await parseBody(request, UpdateStatus);
        await db
          .update(properties)
          .set({
            status: update.status,
            rejectedReason: update.status === "rejected" ? update.reason : null,
          })
          .where(eq(properties.id, row.id));
        return new Response(null, { status: 204 });
      },
    },
    "/flats/api/properties/:id/notes": {
      PUT: async (request) => {
        resolveViewer(identity, request);
        const row = await requireProperty(parseParam(request.params.id, z.uuid()));
        const { notes } = await parseBody(request, UpdateNotes);
        await db.update(properties).set({ notes }).where(eq(properties.id, row.id));
        return new Response(null, { status: 204 });
      },
    },
    "/flats/api/properties/:id/viewings": {
      POST: async (request) => {
        const viewer = resolveViewer(identity, request);
        const row = await requireProperty(parseParam(request.params.id, z.uuid()));
        const input = await parseBody(request, CreateViewing);
        await db.insert(viewings).values({
          propertyId: row.id,
          at: new Date(input.at),
          rating: input.rating,
          notes: input.notes,
          createdBy: viewer.login,
        });
        return new Response(null, { status: 201 });
      },
    },
    "/flats/api/viewings/:id": {
      DELETE: async (request) => {
        resolveViewer(identity, request);
        const id = parseParam(request.params.id, z.uuid());
        const doomed = await db
          .select({ id: viewingPhotos.id })
          .from(viewingPhotos)
          .where(eq(viewingPhotos.viewingId, id));
        const deleted = await db.delete(viewings).where(eq(viewings.id, id)).returning({ id: viewings.id });
        if (deleted.length === 0) {
          throw new HttpError(404, "Not found");
        }
        await Promise.all(doomed.map((photo) => blob.delete(`viewing-photos/${photo.id}`)));
        return new Response(null, { status: 204 });
      },
    },
    "/flats/api/viewings/:id/photos": {
      POST: async (request) => {
        resolveViewer(identity, request);
        const viewingId = parseParam(request.params.id, z.uuid());
        const [viewing] = await db.select({ id: viewings.id }).from(viewings).where(eq(viewings.id, viewingId));
        if (viewing === undefined) {
          throw new HttpError(404, "Not found");
        }
        const file = (await request.formData()).get("file");
        if (!(file instanceof File) || file.size === 0) {
          throw new HttpError(400, "Expected a non-empty file in the `file` field");
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
        return new Response(null, { status: 201 });
      },
    },
    "/flats/api/viewing-photos/:id": {
      GET: async (request) => {
        resolveViewer(identity, request);
        const [photo] = await db
          .select()
          .from(viewingPhotos)
          .where(eq(viewingPhotos.id, parseParam(request.params.id, z.uuid())));
        if (photo === undefined) {
          throw new HttpError(404, "Not found");
        }
        return redirectTo(
          blob.downloadUrl(`viewing-photos/${photo.id}`, {
            filename: photo.filename,
          }),
        );
      },
      DELETE: async (request) => {
        resolveViewer(identity, request);
        const id = parseParam(request.params.id, z.uuid());
        const deleted = await db
          .delete(viewingPhotos)
          .where(eq(viewingPhotos.id, id))
          .returning({ id: viewingPhotos.id });
        if (deleted.length === 0) {
          throw new HttpError(404, "Not found");
        }
        await blob.delete(`viewing-photos/${id}`);
        return new Response(null, { status: 204 });
      },
    },
    "/flats/api/photos/:id": {
      GET: async (request) => {
        resolveViewer(identity, request);
        const [photo] = await db
          .select({
            id: photos.id,
            kind: photos.kind,
            position: photos.position,
          })
          .from(photos)
          .where(eq(photos.id, parseParam(request.params.id, z.uuid())));
        if (photo === undefined) {
          throw new HttpError(404, "Not found");
        }
        return redirectTo(
          blob.downloadUrl(`photos/${photo.id}`, {
            filename: `${photo.kind}-${photo.position + 1}.jpg`,
            expiresInSeconds: 3600,
          }),
        );
      },
    },
    "/flats/api/searches": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json((await db.select().from(searches).orderBy(asc(searches.createdAt))).map(toSearch));
      },
      POST: async (request) => {
        resolveViewer(identity, request);
        const input = await parseBody(request, CreateSearch);
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
        return Response.json(toSearch(created), { status: 201 });
      },
    },
    "/flats/api/searches/:id": {
      PATCH: async (request) => {
        resolveViewer(identity, request);
        const { enabled } = await parseBody(request, UpdateSearch);
        const [updated] = await db
          .update(searches)
          .set(enabled ? { enabled, consecutiveFailures: 0 } : { enabled })
          .where(eq(searches.id, parseParam(request.params.id, z.uuid())))
          .returning();
        if (updated === undefined) {
          throw new HttpError(404, "Not found");
        }
        return Response.json(toSearch(updated));
      },
      DELETE: async (request) => {
        resolveViewer(identity, request);
        const deleted = await db
          .delete(searches)
          .where(eq(searches.id, parseParam(request.params.id, z.uuid())))
          .returning({ id: searches.id });
        if (deleted.length === 0) {
          throw new HttpError(404, "Not found");
        }
        return new Response(null, { status: 204 });
      },
    },
    "/flats/api/listings": {
      POST: async (request) => {
        resolveViewer(identity, request);
        const { url } = await parseBody(request, AddListing);
        for (const parser of parsers) {
          const portalId = parser.portalIdFromUrl(url);
          if (portalId !== null) {
            await work.addListing(parser.portal, portalId);
            return Response.json({ portal: parser.portal, portalId }, { status: 202 });
          }
        }
        throw new HttpError(400, "That is not a listing URL from a supported portal");
      },
    },
    "/flats/api/requirements": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await loadRequirements(db));
      },
      PUT: async (request) => {
        resolveViewer(identity, request);
        const document = await parseBody(request, Requirements);
        await saveRequirements(db, document);
        await work.applyRequirements();
        return Response.json(document);
      },
    },
    "/flats/api/requirements/trial": {
      POST: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await trial(await parseBody(request, TrialRequest), request.signal));
      },
    },
    "/flats/api/destinations": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(
          (await db.select().from(destinations).orderBy(asc(destinations.createdAt))).map(toDestination),
        );
      },
      POST: async (request) => {
        resolveViewer(identity, request);
        const input = await parseBody(request, CreateDestination);
        const place = await geocoder.postcode(input.postcode);
        if (place === null) {
          throw new HttpError(400, `${input.postcode} is not a UK postcode`);
        }
        const [created] = await db
          .insert(destinations)
          .values({
            name: input.name,
            postcode: place.postcode,
            arriveBy: input.arriveBy,
            ...place.location,
          })
          .returning();
        if (created === undefined) {
          throw new Error("INSERT … RETURNING produced no destination");
        }
        await work.timeCommutes();
        return Response.json(toDestination(created), { status: 201 });
      },
    },
    "/flats/api/destinations/:id": {
      DELETE: async (request) => {
        resolveViewer(identity, request);
        const deleted = await db
          .delete(destinations)
          .where(eq(destinations.id, parseParam(request.params.id, z.uuid())))
          .returning({ id: destinations.id });
        if (deleted.length === 0) {
          throw new HttpError(404, "Not found");
        }
        return new Response(null, { status: 204 });
      },
    },
    "/flats/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
};
