import { describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { createFlatsTestbed, defaultPages, ok, searchPage } from "../../test/support";
import { listings, photos, properties, searches, snapshots } from "./schema";
import { isActiveHour, MAX_CONSECUTIVE_FAILURES } from "./work";

const { context, db, blob, setup, addSearch, propertyByPortalId } = createFlatsTestbed();

describe("ingesting a search", () => {
  test("seeds a new search with its listings, their pages and photos", async () => {
    const { work, drain } = setup();
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
        tags: ["chart_with_downwards_trend"],
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
    const { work, fetcher, drain } = setup(defaultPages, new Date("2026-09-28T01:00:00Z"));
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
