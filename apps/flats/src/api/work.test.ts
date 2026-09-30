import { describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { rightmoveListingPage } from "../../test/rightmove-page";
import {
  createFlatsTestbed,
  crimesEachMonth,
  defaultPages,
  fakeCrime,
  fakeExtractor,
  fakePlanner,
  NOON,
  ok,
  type Pages,
  searchPage,
  soldStcPage,
} from "../../test/support";
import { monthsTo } from "./crime";
import type { FeatureExtractor } from "./extractor";
import { SHARED_OWNERSHIP_REASON } from "./ingest";
import type { JourneyPlanner } from "./places";
import { fingerprint, QUESTIONS } from "./questions";
import { latestTexts } from "./readings";
import { DEFAULT_REQUIREMENTS, saveRequirements } from "./requirements";
import { commutes, crime, crimeReports, listings, photos, properties, readings, searches, snapshots } from "./schema";
import { isActiveHour, MAX_CONSECUTIVE_FAILURES } from "./work";

const { context, db, blob, setup, addSearch, addDestination, propertyByPortalId } = createFlatsTestbed();

describe("ingesting a search", () => {
  test("seeds a new search with its listings, their pages and photos", async () => {
    const { work, sent, drain } = setup();
    const search = await addSearch();

    await work.backfillSearch(search.id, 1);
    await drain();

    const union = await propertyByPortalId("93524796");
    expect(union.property).toMatchObject({
      status: "new",
      address: "Union Lane, Isleworth",
      postcode: "TW7 6GH",
      price: 350000,
      availability: "available",
      bedrooms: 2,
      sizeSqft: 656,
      tenure: "leasehold",
      leaseYearsRemaining: 107,
      annualServiceCharge: 3650.64,
      councilTaxBand: "D",
    });
    expect(union.listing.parsed?.keyFeatures).toContain("Private balcony");
    const [stored] =
      await context.sql`select jsonb_typeof(parsed) as type from flats.listings where id = ${union.listing.id}`;
    expect(stored).toEqual({ type: "object" });

    const history = await db
      .select({ source: snapshots.source, pageKey: snapshots.pageKey })
      .from(snapshots)
      .where(eq(snapshots.listingId, union.listing.id))
      .orderBy(asc(snapshots.id));
    expect(history.map((snapshot) => snapshot.source)).toEqual(["search", "page"]);
    expect(await blob.exists(history[1]?.pageKey ?? "")).toBe(true);

    const mirrored = await db.select().from(photos).where(eq(photos.listingId, union.listing.id));
    expect(mirrored.filter((photo) => photo.kind === "photo")).toHaveLength(10);
    expect(mirrored.filter((photo) => photo.kind === "floorplan")).toHaveLength(1);
    expect(await blob.exists(`photos/${mirrored[0]?.id}`)).toBe(true);

    expect((await propertyByPortalId("128855633")).property.availability).toBe("sold_stc");
    expect((await propertyByPortalId("93631518")).property.availability).toBe("removed");

    const [polled] = await db.select().from(searches).where(eq(searches.id, search.id));
    expect(polled).toMatchObject({ consecutiveFailures: 0, lastError: null });
    expect(polled?.lastSucceededAt).not.toBeNull();
    expect(sent).toEqual([]);
  });

  const routinePoll = async (
    pages: Pages = defaultPages,
    extractor: FeatureExtractor | null = fakeExtractor().extractor,
  ) => {
    const polled = setup(pages, { extractor });
    const search = await addSearch();
    await db.update(searches).set({ lastSucceededAt: NOON }).where(eq(searches.id, search.id));
    await context.jobs.enqueue(polled.work.definitions.pollSearches, {});
    await polled.drain();
    return polled;
  };

  test("announces each new listing still on the market, opening on its property", async () => {
    const { sent } = await routinePoll();

    const union = await propertyByPortalId("93524796");
    expect(sent).toEqual([
      {
        title: "New: Union Lane, Isleworth",
        message: "£350,000 · 2 bed · 656 sq ft",
        clickUrl: `https://apps.example/flats/properties/${union.property.id}`,
        tag: union.property.id,
      },
    ]);
  });

  test("does not announce a new listing its page rules out", async () => {
    const tooSmall = rightmoveListingPage({ sizings: [{ unit: "sqft", minimumSize: 649 }] });
    const { sent } = await routinePoll({
      ...defaultPages,
      listing: (portalId) => (portalId === "93524796" ? ok(tooSmall) : defaultPages.listing(portalId)),
    });

    expect((await propertyByPortalId("93524796")).property.status).toBe("rejected");
    expect(sent).toEqual([]);
  });

  test("does not announce a new listing Jev rules out", async () => {
    const { sent } = await routinePoll(defaultPages, fakeExtractor({ auction: { kind: "noul", yes: 0.95 } }).extractor);

    expect((await propertyByPortalId("93524796")).property).toMatchObject({
      status: "rejected",
      rejectedReason: "Auction",
    });
    expect(sent).toEqual([]);
  });

  test("still announces new listings without TypeSafe", async () => {
    const { sent } = await routinePoll(defaultPages, null);

    expect(sent.map((notification) => notification.title)).toEqual(["New: Union Lane, Isleworth"]);
  });

  test("judges a new listing by the saved limits", async () => {
    await saveRequirements(db, {
      ...DEFAULT_REQUIREMENTS,
      limits: { ...DEFAULT_REQUIREMENTS.limits, minSizeSqft: 700 },
    });

    const { sent } = await routinePoll();

    expect((await propertyByPortalId("93524796")).property).toMatchObject({
      status: "rejected",
      rejectedReason: "Under 700 sq ft",
    });
    expect(sent).toEqual([]);
  });

  test("records a price drop and alerts only for tracked properties", async () => {
    const first = setup();
    const search = await addSearch();
    await first.work.backfillSearch(search.id, 1);
    await first.drain();
    await db.update(properties).set({ status: "shortlisted" }).where(eq(properties.address, "Union Lane, Isleworth"));

    const cheaper = setup({
      ...defaultPages,
      search: () =>
        ok(
          searchPage.replaceAll('"amount":350000', '"amount":325000').replaceAll('"amount":450000', '"amount":440000'),
        ),
    });
    await cheaper.work.backfillSearch(search.id, 1);
    await cheaper.drain();

    const union = await propertyByPortalId("93524796");
    expect(union.property.price).toBe(325000);
    expect(cheaper.sent).toEqual([
      {
        title: "Union Lane, Isleworth",
        message: "Price £350,000 → £325,000",
        clickUrl: `https://apps.example/flats/properties/${union.property.id}`,
        priority: "default",
        tag: union.property.id,
      },
    ]);
    expect((await propertyByPortalId("128855633")).property.price).toBe(440000);
  });

  test("pauses a search and alerts once it keeps getting blocked", async () => {
    const { work, sent, drain } = setup({
      ...defaultPages,
      search: () => ({ kind: "blocked", status: 403 }),
    });
    const search = await addSearch();

    for (let poll = 0; poll < MAX_CONSECUTIVE_FAILURES + 1; poll++) {
      await work.backfillSearch(search.id, 1);
      await drain();
    }

    const [paused] = await db.select().from(searches).where(eq(searches.id, search.id));
    expect(paused).toMatchObject({
      enabled: false,
      consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
      lastError: "Blocked with 403",
    });
    expect(sent.map((notification) => notification.title)).toEqual(['Search "West London flats" paused']);
  });

  test("buries a listing whose page no longer parses, keeping the search result", async () => {
    const { work, drain } = setup({
      ...defaultPages,
      listing: () => ok("<html>redesigned</html>"),
    });
    const search = await addSearch();

    await work.backfillSearch(search.id, 1);
    expect(await drain()).toMatchObject({ dead: 4 });

    const union = await propertyByPortalId("93524796");
    expect(union.property.price).toBe(350000);
    expect(union.listing.parsed).toBeNull();
  });
});

describe("tracking", () => {
  test("refreshes only tracked listings still on the market", async () => {
    const first = setup();
    const search = await addSearch();
    await first.work.backfillSearch(search.id, 1);
    await first.drain();
    await db.update(properties).set({ status: "viewed" });

    const refresh = setup();
    await context.jobs.enqueue(refresh.work.definitions.refreshTracked, {});
    await refresh.drain();

    const listingPages = refresh.fetcher.requested.filter((url) => url.includes("/properties/"));
    expect(listingPages.sort()).toEqual([
      "https://www.rightmove.co.uk/properties/128855633",
      "https://www.rightmove.co.uk/properties/93524796",
    ]);
  });
});

describe("polling hours", () => {
  test("polls between 07:00 and 23:00 London time", () => {
    expect(isActiveHour(new Date("2026-09-28T05:59:00Z"))).toBe(false);
    expect(isActiveHour(new Date("2026-09-28T06:00:00Z"))).toBe(true);
    expect(isActiveHour(new Date("2026-09-28T21:59:00Z"))).toBe(true);
    expect(isActiveHour(new Date("2026-09-28T22:00:00Z"))).toBe(false);
    expect(isActiveHour(new Date("2026-12-01T07:00:00Z"))).toBe(true);
  });

  test("skips the scheduled poll overnight", async () => {
    const { work, fetcher, drain } = setup(defaultPages, { now: new Date("2026-09-28T01:00:00Z") });
    await addSearch();
    await context.jobs.enqueue(work.definitions.pollSearches, {});
    await drain();
    expect(fetcher.requested).toEqual([]);
  });
});

describe("adding a listing by URL", () => {
  test("creates the property from its page", async () => {
    const { work, drain } = setup();

    expect(await work.addListing("rightmove", "93524796")).toBe(true);
    expect(await work.addListing("rightmove", "93524796")).toBe(false);
    await drain();

    const union = await propertyByPortalId("93524796");
    expect(union.property).toMatchObject({
      address: "Union Lane, Isleworth",
      leaseYearsRemaining: 107,
      status: "new",
    });
    expect(await db.select().from(photos).where(eq(photos.listingId, union.listing.id))).toHaveLength(11);
  });

  test("refreshes a listing that is already known instead of duplicating it", async () => {
    const first = setup();
    await first.work.addListing("rightmove", "93524796");
    await first.drain();

    const again = setup();
    await again.work.addListing("rightmove", "93524796");
    await again.drain();

    expect(await db.select().from(listings).where(eq(listings.portalId, "93524796"))).toHaveLength(1);
    expect(again.fetcher.requested).toContain("https://www.rightmove.co.uk/properties/93524796");
  });

  test("buries a listing that does not exist", async () => {
    const { work, drain } = setup();
    await work.addListing("rightmove", "1");
    expect(await drain()).toMatchObject({ dead: 1 });
  });
});

describe("crime", () => {
  const countedFor = async (portalId: string) => {
    const { property } = await propertyByPortalId(portalId);
    const [counted] = await db.select().from(crime).where(eq(crime.propertyId, property.id));
    return counted;
  };
  const pairs = (asked: readonly { bounds: { south: number; west: number }; month: string }[]) =>
    asked.map(({ bounds, month }) => `${bounds.south},${bounds.west} ${month}`);

  test("counts a year of street crime near each property, fetching each area and month once", async () => {
    const police = fakeCrime("2026-07");
    const { work, drain } = setup(defaultPages, { crime: police.crime });
    await work.backfillSearch((await addSearch()).id, 1);
    await drain();

    expect(await countedFor("93524796")).toMatchObject({
      throughMonth: "2026-07",
      months: 12,
      radiusMetres: 400,
      byCategory: { burglary: 24, "violent-crime": 60 },
    });
    expect(new Set(pairs(police.asked)).size).toBe(police.asked.length);
    expect(new Set(police.asked.map(({ month }) => month))).toEqual(new Set(monthsTo("2026-07", 12)));
    expect(await db.select().from(crimeReports)).toHaveLength(12 * 7);
  });

  test("once a newer month is out, fetches only that month", async () => {
    const before = fakeCrime("2026-07", crimesEachMonth("2026-08"));
    const first = setup(defaultPages, { crime: before.crime });
    await first.work.backfillSearch((await addSearch()).id, 1);
    await first.drain();

    const areas = before.asked.length;
    await context.jobs.enqueue(first.work.definitions.sweepCrime, {});
    await first.drain();
    expect(before.asked).toHaveLength(areas);

    const after = fakeCrime("2026-08");
    const later = setup(defaultPages, { crime: after.crime });
    await context.jobs.enqueue(later.work.definitions.sweepCrime, {});
    await later.drain();

    expect(new Set(after.asked.map(({ month }) => month))).toEqual(new Set(["2026-08"]));
    expect(await countedFor("93524796")).toMatchObject({
      throughMonth: "2026-08",
      byCategory: { burglary: 24, "violent-crime": 60 },
    });
  });
});

describe("commutes", () => {
  const seed = async (planner: JourneyPlanner | null) => {
    const seeded = setup(defaultPages, { planner });
    await seeded.work.backfillSearch((await addSearch()).id, 1);
    await seeded.drain();
    return seeded;
  };

  const timed = () =>
    db
      .select({ propertyId: commutes.propertyId, destinationId: commutes.destinationId, minutes: commutes.minutes })
      .from(commutes);

  test("times each property still on the market to each place, once", async () => {
    const office = await addDestination("Office", "09:00");
    const gym = await addDestination("Gym", "18:30");
    const { planner, asked } = fakePlanner(43);

    const { work, drain } = await seed(planner);

    const union = await propertyByPortalId("93524796");
    const soldStc = await propertyByPortalId("128855633");
    expect(await timed()).toEqual(
      expect.arrayContaining([
        { propertyId: union.property.id, destinationId: office.id, minutes: 43 },
        { propertyId: union.property.id, destinationId: gym.id, minutes: 43 },
        { propertyId: soldStc.property.id, destinationId: office.id, minutes: 43 },
        { propertyId: soldStc.property.id, destinationId: gym.id, minutes: 43 },
      ]),
    );
    expect(await timed()).toHaveLength(4);
    expect(asked).toContainEqual({
      from: { latitude: 51.476311, longitude: -0.324446 },
      to: { latitude: office.latitude, longitude: office.longitude },
      arriveBy: { date: "20260922", time: "0900" },
    });
    expect(asked.map((question) => question.arriveBy.time)).toContain("1830");

    await context.jobs.enqueue(work.definitions.computeCommutes, { propertyId: union.property.id });
    await drain();
    expect(asked).toHaveLength(4);
  });

  test("records a place TfL finds no route to", async () => {
    const office = await addDestination();

    await seed(fakePlanner(null).planner);

    const { property } = await propertyByPortalId("93524796");
    expect(await timed()).toContainEqual({ propertyId: property.id, destinationId: office.id, minutes: null });
  });

  test("leaves commutes untimed without TfL", async () => {
    await addDestination();

    await seed(null);

    expect(await timed()).toEqual([]);
  });

  test("the daily sweep times what was missed, e.g. before TfL was configured", async () => {
    await addDestination();
    await seed(null);

    const configured = setup(defaultPages, { planner: fakePlanner(31).planner });
    await context.jobs.enqueue(configured.work.definitions.sweepCommutes, {});
    await configured.drain();

    const { property } = await propertyByPortalId("93524796");
    expect((await timed()).filter((commute) => commute.propertyId === property.id)).toEqual([
      expect.objectContaining({ minutes: 31 }),
    ]);
  });

  test("skips properties without a location, rejected, or taken down", async () => {
    const { planner, asked } = fakePlanner();
    const { work, drain } = await seed(planner);
    const union = await propertyByPortalId("93524796");
    const soldStc = await propertyByPortalId("128855633");
    const removed = await propertyByPortalId("93631518");
    await db.update(properties).set({ latitude: null, longitude: null }).where(eq(properties.id, union.property.id));
    await db
      .update(properties)
      .set({ status: "rejected", rejectedReason: "Too far" })
      .where(eq(properties.id, soldStc.property.id));
    await db.update(properties).set({ latitude: 51.5, longitude: -0.1 }).where(eq(properties.id, removed.property.id));
    await addDestination();

    await work.timeCommutes();
    for (const { property } of [union, soldStc, removed]) {
      await context.jobs.enqueue(work.definitions.computeCommutes, { propertyId: property.id });
    }
    await drain();

    expect(asked).toEqual([]);
    expect(await timed()).toEqual([]);
  });
});

describe("shared ownership", () => {
  const sharedOwnershipPage = rightmoveListingPage({
    sharedOwnership: { sharedOwnershipFlag: true },
    location: { latitude: 51.476311, longitude: -0.324446 },
  });
  const withSharedOwnershipPage: Pages = {
    ...defaultPages,
    listing: (portalId) => (portalId === "93524796" ? ok(sharedOwnershipPage) : defaultPages.listing(portalId)),
  };

  test("never ingests a search result that says it is shared ownership", async () => {
    const { work, fetcher, drain } = setup({
      ...defaultPages,
      search: () => ok(searchPage.replace('"summary":"A modern,', '"summary":"Shared ownership. A modern,')),
    });

    await work.backfillSearch((await addSearch()).id, 1);
    await drain();

    await expect(propertyByPortalId("93524796")).rejects.toThrow();
    expect(fetcher.requested).not.toContain("https://www.rightmove.co.uk/properties/93524796");
    expect((await propertyByPortalId("128855633")).property.status).toBe("new");
  });

  test("rejects an untriaged property whose page says it is shared ownership, and does not time it", async () => {
    await addDestination();
    const { work, drain } = setup(withSharedOwnershipPage);

    await work.backfillSearch((await addSearch()).id, 1);
    await drain();

    const union = await propertyByPortalId("93524796");
    expect(union.property).toMatchObject({
      status: "rejected",
      rejectedReason: SHARED_OWNERSHIP_REASON,
      sharedOwnership: true,
    });
    const soldStc = await propertyByPortalId("128855633");
    expect(soldStc.property.status).toBe("new");
    expect((await db.select().from(commutes)).map((commute) => commute.propertyId)).toEqual([soldStc.property.id]);
  });

  test("leaves a property already being pursued to its owner", async () => {
    const first = setup();
    await first.work.backfillSearch((await addSearch()).id, 1);
    await first.drain();
    await db.update(properties).set({ status: "shortlisted" }).where(eq(properties.address, "Union Lane, Isleworth"));

    const refresh = setup(withSharedOwnershipPage);
    await context.jobs.enqueue(refresh.work.definitions.refreshTracked, {});
    await refresh.drain();

    expect((await propertyByPortalId("93524796")).property).toMatchObject({
      status: "shortlisted",
      sharedOwnership: true,
    });
  });
});

describe("size and service charge", () => {
  const ingestUnionLane = async (overrides: Record<string, unknown>) => {
    const page = rightmoveListingPage(overrides);
    const { work, drain } = setup({
      ...defaultPages,
      listing: (portalId) => (portalId === "93524796" ? ok(page) : defaultPages.listing(portalId)),
    });
    await work.backfillSearch((await addSearch()).id, 1);
    await drain();
    return (await propertyByPortalId("93524796")).property;
  };
  const sized = (minimumSize: number) => ({ sizings: [{ unit: "sqft", minimumSize }] });
  const charged = (annualServiceCharge: number) => ({
    livingCosts: { annualServiceCharge, annualGroundRent: 0, councilTaxBand: "TBC" },
  });
  const leased = (yearsRemainingOnLease: number) => ({ tenure: { tenureType: "LEASEHOLD", yearsRemainingOnLease } });

  test("rejects an untriaged property under 650 sq ft", async () => {
    expect(await ingestUnionLane(sized(649))).toMatchObject({
      status: "rejected",
      rejectedReason: "Under 650 sq ft",
      sizeSqft: 649,
    });
  });

  test("rejects the real 593 sq ft sold STC flat", async () => {
    const { work, drain } = setup({
      ...defaultPages,
      listing: (portalId) => (portalId === "128855633" ? ok(soldStcPage) : defaultPages.listing(portalId)),
    });
    await work.backfillSearch((await addSearch()).id, 1);
    await drain();

    expect((await propertyByPortalId("128855633")).property).toMatchObject({
      status: "rejected",
      rejectedReason: "Under 650 sq ft",
      sizeSqft: 593,
    });
  });

  test("rejects an untriaged property whose service charge is over £6,000", async () => {
    expect(await ingestUnionLane(charged(6000.01))).toMatchObject({
      status: "rejected",
      rejectedReason: "Service charge over £6,000",
      annualServiceCharge: 6000.01,
    });
  });

  test("rejects an untriaged property with under 90 years left on its lease", async () => {
    expect(await ingestUnionLane(leased(89))).toMatchObject({
      status: "rejected",
      rejectedReason: "Lease under 90 years",
      leaseYearsRemaining: 89,
    });
  });

  test("keeps a property on each limit, or that states none", async () => {
    expect((await ingestUnionLane({ ...sized(650), ...charged(6000), ...leased(90) })).status).toBe("new");
    expect((await ingestUnionLane({})).status).toBe("new");
  });
});

describe("reading listings with Jev", () => {
  const seed = async (extractor: FeatureExtractor | null) => {
    const seeded = setup(defaultPages, { extractor });
    await seeded.work.backfillSearch((await addSearch()).id, 1);
    await seeded.drain();
    return seeded;
  };

  /** What Jev has answered about the property's current listing text. */
  const answersFor = async (propertyId: string) => {
    const text = (await latestTexts(db, [propertyId])).get(propertyId);
    return text === undefined
      ? []
      : db
          .select({ fingerprint: readings.questionFingerprint, model: readings.model })
          .from(readings)
          .where(eq(readings.textFingerprint, text.fingerprint));
  };

  test("asks every question about each property still in play, once", async () => {
    const { extractor, asked } = fakeExtractor();
    const { work, drain } = await seed(extractor);

    const union = await propertyByPortalId("93524796");
    expect(await answersFor(union.property.id)).toEqual(
      expect.arrayContaining(QUESTIONS.map((question) => ({ fingerprint: fingerprint(question), model: "jev-fake" }))),
    );
    expect(await answersFor(union.property.id)).toHaveLength(QUESTIONS.length);
    const removed = await propertyByPortalId("93631518");
    expect(await answersFor(removed.property.id)).toEqual([]);

    const calls = asked.length;
    await context.jobs.enqueue(work.definitions.readListing, { propertyId: union.property.id, announce: false });
    await drain();
    expect(asked).toHaveLength(calls);
  });

  test("reads a listing again, in full, once its text changes", async () => {
    await seed(fakeExtractor().extractor);
    const union = await propertyByPortalId("93524796");
    const [page] = await db
      .select({ id: listings.id, parsed: listings.parsed })
      .from(listings)
      .where(eq(listings.propertyId, union.property.id));
    if (page?.parsed == null) {
      throw new Error("Union Lane was never parsed");
    }
    await db
      .update(listings)
      .set({ parsed: { ...page.parsed, description: `${page.parsed.description} Now with a roof terrace.` } })
      .where(eq(listings.id, page.id));

    const again = fakeExtractor();
    const rerun = setup(defaultPages, { extractor: again.extractor });
    await context.jobs.enqueue(rerun.work.definitions.readListing, { propertyId: union.property.id, announce: false });
    await rerun.drain();

    expect(again.asked).toEqual([QUESTIONS.map((question) => question.key)]);
    expect(await answersFor(union.property.id)).toHaveLength(QUESTIONS.length);
  });

  test("asks a reworded question again, and only that one", async () => {
    await seed(fakeExtractor().extractor);
    const reworded = QUESTIONS.map((question) =>
      question.key === "lift" ? { ...question, instructions: `${question.instructions} Or an elevator?` } : question,
    );
    const again = fakeExtractor();
    const { work, drain } = setup(defaultPages, { extractor: again.extractor });

    await saveRequirements(db, { ...DEFAULT_REQUIREMENTS, questions: reworded });
    await work.applyRequirements();
    await drain();

    expect(again.asked).toEqual([["lift"], ["lift"]]);
  });

  test("rejects an untriaged property Jev is sure is excluded, leaving one being pursued", async () => {
    await seed(fakeExtractor().extractor);
    const soldStc = await propertyByPortalId("128855633");
    await db.update(properties).set({ status: "shortlisted" }).where(eq(properties.id, soldStc.property.id));
    await db.delete(readings);

    const retirement = fakeExtractor({ retirement: { kind: "noul", yes: 0.97 } });
    const { work, drain } = setup(defaultPages, { extractor: retirement.extractor });
    await context.jobs.enqueue(work.definitions.sweepReadings, {});
    await drain();

    expect((await propertyByPortalId("93524796")).property).toMatchObject({
      status: "rejected",
      rejectedReason: "Retirement property",
    });
    expect((await propertyByPortalId("128855633")).property.status).toBe("shortlisted");
  });

  test("leaves listings unread without TypeSafe, until the daily sweep", async () => {
    await seed(null);
    const { property } = await propertyByPortalId("93524796");
    expect(await answersFor(property.id)).toEqual([]);

    const configured = fakeExtractor();
    const { work, drain } = setup(defaultPages, { extractor: configured.extractor });
    await context.jobs.enqueue(work.definitions.sweepReadings, {});
    await drain();

    expect(await answersFor(property.id)).toHaveLength(QUESTIONS.length);
  });
});

describe("saving requirements", () => {
  test("rejects untriaged properties the new limits rule out, leaving those being pursued", async () => {
    const { work, drain } = setup();
    await work.backfillSearch((await addSearch()).id, 1);
    await drain();
    const soldStc = await propertyByPortalId("128855633");
    await db.update(properties).set({ status: "shortlisted" }).where(eq(properties.id, soldStc.property.id));

    await saveRequirements(db, {
      ...DEFAULT_REQUIREMENTS,
      limits: { ...DEFAULT_REQUIREMENTS.limits, minSizeSqft: 700 },
    });
    await work.applyRequirements();

    expect((await propertyByPortalId("93524796")).property).toMatchObject({
      status: "rejected",
      rejectedReason: "Under 700 sq ft",
    });
    expect((await propertyByPortalId("128855633")).property.status).toBe("shortlisted");
  });
});
