import { beforeEach, describe, expect, test } from "bun:test";
import { createBlobStore, drainJobs, type Notification } from "@nas/core";
import { createTestContext } from "@nas/core/testing";
import { asc, eq } from "drizzle-orm";
import { flatsDb } from "./db";
import type { Download, Fetcher, FetchResult } from "./fetcher";
import { rightmove } from "./portals/rightmove";
import { listings, photos, properties, searches, snapshots } from "./schema";
import { createFlatsWork, isActiveHour, MAX_CONSECUTIVE_FAILURES } from "./work";

const context = createTestContext();
const db = flatsDb(context.sql);
const blob = createBlobStore(context.blob, `flats-test/${crypto.randomUUID()}`);

const fixture = (name: string) => Bun.file(new URL(`../../test/fixtures/rightmove/${name}`, import.meta.url)).text();
const [searchPage, listingPage, soldStcPage] = await Promise.all([
  fixture("search.html"),
  fixture("listing.html"),
  fixture("listing-sold-stc.html"),
]);

type Pages = { search: () => FetchResult<string>; listing: (portalId: string) => FetchResult<string> };

const JPEG: FetchResult<Download> = {
  kind: "ok",
  body: { data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), contentType: "image/jpeg" },
};

const fakeFetcher = (pages: Pages): Fetcher & { readonly requested: string[] } => {
  const requested: string[] = [];
  return {
    requested,
    text: async (url) => {
      requested.push(url);
      const listingId = rightmove.portalIdFromUrl(url);
      return listingId === null ? pages.search() : pages.listing(listingId);
    },
    bytes: async (url) => {
      requested.push(url);
      return JPEG;
    },
  };
};

const ok = (body: string): FetchResult<string> => ({ kind: "ok", body });
const LISTING_PAGES: Readonly<Record<string, string>> = { "93524796": listingPage, "128855633": soldStcPage };
const defaultPages: Pages = {
  search: () => ok(searchPage),
  listing: (portalId) => {
    const page = LISTING_PAGES[portalId];
    return page === undefined ? { kind: "gone" } : ok(page);
  },
};

/** Noon on a past British Summer Time weekday: inside polling hours, and already due by the database clock. */
const NOON = new Date("2026-09-21T11:00:00Z");

const setup = (pages: Pages = defaultPages, now = NOON) => {
  const sent: Notification[] = [];
  const fetcher = fakeFetcher(pages);
  const work = createFlatsWork({
    db,
    blob,
    queue: context.jobs,
    notifier: { send: async (notification) => void sent.push(notification) },
    fetcher,
    parsers: { rightmove },
    publicUrl: "https://apps.example",
    now: () => now,
  });
  return { work, sent, fetcher, drain: () => drainJobs(context.sql, work.jobs) };
};

const addSearch = async () => {
  const [search] = await db
    .insert(searches)
    .values({
      name: "West London flats",
      portal: "rightmove",
      url: `https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E87490&t=${crypto.randomUUID()}`,
    })
    .returning();
  if (search === undefined) {
    throw new Error("no search");
  }
  return search;
};

const propertyByPortalId = async (portalId: string) => {
  const [row] = await db
    .select({ property: properties, listing: listings })
    .from(listings)
    .innerJoin(properties, eq(properties.id, listings.propertyId))
    .where(eq(listings.portalId, portalId));
  if (row === undefined) {
    throw new Error(`no listing ${portalId}`);
  }
  return row;
};

beforeEach(async () => {
  await context.sql`truncate flats.searches, flats.properties cascade`;
  await context.sql`delete from jobs.jobs where name like 'flats.%'`;
});

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
    const { work, sent, drain } = setup({ ...defaultPages, search: () => ({ kind: "blocked", status: 403 }) });
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
    const { work, drain } = setup({ ...defaultPages, listing: () => ok("<html>redesigned</html>") });
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
