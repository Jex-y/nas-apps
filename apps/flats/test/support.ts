import { beforeEach } from "bun:test";
import { type AppContext, createBlobStore, drainJobs, type Notification } from "@apps/core";
import { createTestContext } from "@apps/core/testing";
import { eq } from "drizzle-orm";
import { type Bounds, type CrimeRecords, type CrimeReport, monthsTo } from "../src/api/crime";
import { flatsDb } from "../src/api/db";
import type { FeatureExtractor } from "../src/api/extractor";
import type { Download, Fetcher, FetchResult } from "../src/api/fetcher";
import type { ArriveBy, Coordinates, Geocoder, JourneyPlanner } from "../src/api/places";
import { rightmove } from "../src/api/portals/rightmove";
import { destinations, listings, properties, searches } from "../src/api/schema";
import { createFlatsWork } from "../src/api/work";
import type { Answer, Question } from "../src/contract";

const fixture = (name: string) => Bun.file(new URL(`./fixtures/rightmove/${name}`, import.meta.url)).text();
export const [searchPage, listingPage, soldStcPage] = await Promise.all([
  fixture("search.html"),
  fixture("listing.html"),
  fixture("listing-sold-stc.html"),
]);

export type Pages = { search: () => FetchResult<string>; listing: (portalId: string) => FetchResult<string> };

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

export const ok = (body: string): FetchResult<string> => ({ kind: "ok", body });
/** The sold STC flat is really 593 sq ft; lifted to the 650 sq ft minimum so it stays in play. */
const soldStcInPlay = soldStcPage.replace('\\"sq. ft.\\",593,', '\\"sq. ft.\\",650,');
const LISTING_PAGES: Readonly<Record<string, string>> = { "93524796": listingPage, "128855633": soldStcInPlay };
export const defaultPages: Pages = {
  search: () => ok(searchPage),
  listing: (portalId) => {
    const page = LISTING_PAGES[portalId];
    return page === undefined ? { kind: "gone" } : ok(page);
  },
};

/** A journey planner that answers every query with `minutes`, recording what it was asked. */
export const fakePlanner = (minutes: number | null = 43) => {
  const asked: { from: Coordinates; to: Coordinates; arriveBy: ArriveBy }[] = [];
  const planner: JourneyPlanner = {
    fastestMinutes: async (from, to, arriveBy) => {
      asked.push({ from, to, arriveBy });
      return minutes;
    },
  };
  return { planner, asked };
};

/** Where the Union Lane fixture listing is. */
const UNION_LANE = { latitude: 51.476311, longitude: -0.324446 };

/** Two burglaries and five violent crimes at `at` each month for two years to `latest`. */
export const crimesEachMonth = (latest: string, at: Coordinates = UNION_LANE): CrimeReport[] =>
  monthsTo(latest, 24).flatMap((month) =>
    ["burglary", "burglary", "violent-crime", "violent-crime", "violent-crime", "violent-crime", "violent-crime"].map(
      (category, offset) => ({ id: Number(month.replace("-", "")) * 100 + offset, month, category, ...at }),
    ),
  );

/** The police have published to `latest` and recorded `reports`; `asked` lists each area and month requested. */
export const fakeCrime = (latest = "2026-07", reports: readonly CrimeReport[] = crimesEachMonth(latest)) => {
  const asked: { bounds: Bounds; month: string }[] = [];
  const crime: CrimeRecords = {
    latestMonth: async () => latest,
    inArea: async (bounds, month) => {
      asked.push({ bounds, month });
      return reports.filter(
        (report) =>
          report.month === month &&
          report.latitude >= bounds.south &&
          report.latitude < bounds.north &&
          report.longitude >= bounds.west &&
          report.longitude < bounds.east,
      );
    },
  };
  return { crime, asked };
};

/** A certain answer at a question's first option or level, or a confident no. */
const certainFirst = (question: Question): Answer => {
  switch (question.kind) {
    case "exclusion":
    case "feature":
      return { kind: "noul", yes: 0.02 };
    case "choice": {
      return { kind: "choice", probabilities: { [question.options[0]?.key ?? ""]: 1 } };
    }
    case "score":
      return { kind: "score", probabilities: question.levels.map((_, level) => (level === 0 ? 1 : 0)) };
  }
};

/**
 * A Jev that answers every question as `answers` says, else certain of its first option or a confident no, recording
 * which questions each call asked.
 */
export const fakeExtractor = (answers: Readonly<Record<string, Answer>> = {}) => {
  const asked: string[][] = [];
  const extractor: FeatureExtractor = {
    answer: async (_state, questions) => {
      asked.push(questions.map((question) => question.key));
      return {
        model: "jev-fake",
        answers: new Map(questions.map((question) => [question.key, answers[question.key] ?? certainFirst(question)])),
      };
    },
  };
  return { extractor, asked };
};

/** Knows Fora Chancery House's postcode and nothing else. */
export const fakeGeocoder: Geocoder = {
  postcode: async (postcode) =>
    postcode.replace(/\s/g, "").toUpperCase() === "WC2A1QS"
      ? { postcode: "WC2A 1QS", location: { latitude: 51.5162, longitude: -0.1117 } }
      : null,
};

/** Noon on a past British Summer Time weekday: inside polling hours, and already due by the database clock. */
export const NOON = new Date("2026-09-21T11:00:00Z");

/**
 * A flats pipeline over the real test database and blob store, with the portals replaced by the saved fixtures
 * and notifications by a list. Call once per test file: it owns that file's connection, and empties the flats tables and
 * flats jobs before each test.
 */
export const createFlatsTestbed = () => {
  const context: AppContext = createTestContext();
  const db = flatsDb(context.sql);
  const blob = createBlobStore(context.blob, `flats-test/${crypto.randomUUID()}`);

  const setup = (
    pages: Pages = defaultPages,
    {
      now = NOON,
      planner = fakePlanner().planner,
      crime = fakeCrime().crime,
      extractor = fakeExtractor().extractor,
    }: {
      readonly now?: Date;
      readonly planner?: JourneyPlanner | null;
      readonly crime?: CrimeRecords;
      readonly extractor?: FeatureExtractor | null;
    } = {},
  ) => {
    const sent: Notification[] = [];
    const fetcher = fakeFetcher(pages);
    const work = createFlatsWork({
      db,
      blob,
      queue: context.jobs,
      notifier: { send: async (notification) => void sent.push(notification) },
      fetcher,
      parsers: { rightmove },
      planner,
      crime,
      extractor,
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

  /** A place to commute to, at Fora Chancery House. */
  const addDestination = async (name = "Office", arriveBy = "09:00") => {
    const [destination] = await db
      .insert(destinations)
      .values({ name, postcode: "WC2A 1QS", latitude: 51.5162, longitude: -0.1117, arriveBy })
      .returning();
    if (destination === undefined) {
      throw new Error("no destination");
    }
    return destination;
  };

  beforeEach(async () => {
    await context.sql`truncate flats.searches, flats.properties, flats.destinations, flats.requirements, flats.crime_reports, flats.crime_tiles cascade`;
    await context.sql`delete from jobs.jobs where name like 'flats.%'`;
  });

  return { context, db, blob, setup, addSearch, addDestination, propertyByPortalId };
};
