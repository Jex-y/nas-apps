import { describe, expect, test } from "bun:test";
import { startTestServer, uniqueLogin } from "@apps/core/testing";
import { drizzle } from "drizzle-orm/bun-sql";
import { createFlatsTestbed, fakeExtractor, fakeGeocoder, fakePlanner } from "../../test/support";
import { Destination, DestinationList, PropertyDetail, PropertyList, Search, SearchList } from "../contract";
import { createFlatsApp } from "../module";
import { collapseHistory } from "./routes";

const { context, setup, addSearch, propertyByPortalId } = createFlatsTestbed();
const request = startTestServer(
  (ctx) => [
    createFlatsApp(ctx, {
      geocoder: fakeGeocoder,
      planner: fakePlanner().planner,
      extractor: fakeExtractor().extractor,
    }),
  ],
  context,
);
const me = uniqueLogin();

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

const seed = async () => {
  const { work, drain } = setup();
  await work.backfillSearch((await addSearch()).id, 1);
  await drain();
};

const queuedJobs = async (name: string) =>
  (await context.sql`select payload from jobs.jobs where name = ${name} and state = 'pending'`) as {
    payload: unknown;
  }[];

describe("properties", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/flats/api/properties")).status).toBe(401);
  });

  test("lists properties by status with a mirrored cover photo", async () => {
    await seed();

    const response = await request("/flats/api/properties?status=new", { as: me });
    const list = PropertyList.parse(await response.json());

    expect(list).toHaveLength(4);
    const union = list.find((property) => property.address === "Union Lane, Isleworth");
    expect(union).toMatchObject({
      price: 350000,
      tenure: "leasehold",
      leaseYearsRemaining: 107,
      listings: [{ portal: "rightmove", url: "https://www.rightmove.co.uk/properties/93524796" }],
    });
    expect(union?.thumbnailUrl).toStartWith("/flats/api/photos/");

    const photo = await request(union?.thumbnailUrl ?? "", { as: me });
    expect(photo.status).toBe(302);
    expect(photo.headers.get("Location")).toContain("X-Amz-Signature");
  });

  test("ranks each property by what Jev read and its price per sq ft against the inbox", async () => {
    await seed();

    const list = PropertyList.parse(await (await request("/flats/api/properties?status=new", { as: me })).json());

    const union = list.find((property) => property.address === "Union Lane, Isleworth");
    expect(union?.ranking).toMatchObject({
      kind: "scored",
      contributions: expect.arrayContaining([
        { label: "Outdoor space", detail: "Private garden", points: 3 },
        expect.objectContaining({ label: "Price per sq ft", detail: expect.stringContaining("the inbox median") }),
      ]),
    });
  });

  test("rejects an unknown status filter", async () => {
    expect((await request("/flats/api/properties?status=maybe", { as: me })).status).toBe(404);
  });

  test("shows a property's page details, photos and history", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");

    const detail = PropertyDetail.parse(
      await (await request(`/flats/api/properties/${property.id}`, { as: me })).json(),
    );

    expect(detail.keyFeatures).toContain("Private balcony");
    expect(detail.agent?.name).toBe("Chase Buchanan, Isleworth & Osterley");
    expect(detail.photos.filter((photo) => photo.kind === "photo")).toHaveLength(10);
    expect(detail.history).toEqual([expect.objectContaining({ price: 350000, availability: "available" })]);
  });

  test("rejects without a reason, storing an absent or blank one as none", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");
    const status = `/flats/api/properties/${property.id}/status`;

    for (const update of [
      { status: "rejected" },
      { status: "rejected", reason: null },
      { status: "rejected", reason: "  " },
    ]) {
      await request(status, { as: me, method: "PUT", ...json({ status: "new" }) });
      expect((await request(status, { as: me, method: "PUT", ...json(update) })).status).toBe(204);
      expect((await propertyByPortalId("93524796")).property).toMatchObject({
        status: "rejected",
        rejectedReason: null,
      });
    }
  });

  test("keeps a rejection's reason, and clears it when un-rejected", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");
    const status = `/flats/api/properties/${property.id}/status`;

    expect(
      (await request(status, { as: me, method: "PUT", ...json({ status: "rejected", reason: "Service charge" }) }))
        .status,
    ).toBe(204);
    expect((await propertyByPortalId("93524796")).property).toMatchObject({
      status: "rejected",
      rejectedReason: "Service charge",
    });

    await request(status, { as: me, method: "PUT", ...json({ status: "shortlisted" }) });
    expect((await propertyByPortalId("93524796")).property).toMatchObject({
      status: "shortlisted",
      rejectedReason: null,
    });
  });

  test("records viewings with photos", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");

    const created = await request(`/flats/api/properties/${property.id}/viewings`, {
      as: me,
      method: "POST",
      ...json({ at: "2026-09-30T18:30:00+01:00", rating: 4, notes: "Bright, noisy road" }),
    });
    expect(created.status).toBe(201);

    const [viewing] = PropertyDetail.parse(
      await (await request(`/flats/api/properties/${property.id}`, { as: me })).json(),
    ).viewings;
    expect(viewing).toMatchObject({
      at: "2026-09-30T17:30:00.000Z",
      rating: 4,
      notes: "Bright, noisy road",
      createdBy: me,
    });

    const upload = new FormData();
    upload.set("file", new File(["jpeg"], "kitchen.jpg", { type: "image/jpeg" }));
    expect(
      (await request(`/flats/api/viewings/${viewing?.id}/photos`, { as: me, method: "POST", body: upload })).status,
    ).toBe(201);

    const [withPhoto] = PropertyDetail.parse(
      await (await request(`/flats/api/properties/${property.id}`, { as: me })).json(),
    ).viewings;
    expect(withPhoto?.photos).toEqual([expect.objectContaining({ filename: "kitchen.jpg" })]);
    const download = await request(withPhoto?.photos[0]?.url ?? "", { as: me });
    expect(download.status).toBe(302);
    expect(await (await fetch(download.headers.get("Location") ?? "")).text()).toBe("jpeg");
  });
});

describe("searches", () => {
  test("saves a Rightmove search and seeds it with three pages", async () => {
    const url = `https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E87490&x=${crypto.randomUUID()}`;
    const response = await request("/flats/api/searches", { as: me, method: "POST", ...json({ name: "London", url }) });

    expect(response.status).toBe(201);
    const search = Search.parse(await response.json());
    const polls = (await queuedJobs("flats.poll-search")).map((job) => job.payload);
    expect(polls).toEqual(
      expect.arrayContaining([
        { searchId: search.id, offset: 0 },
        { searchId: search.id, offset: 24 },
        { searchId: search.id, offset: 48 },
      ]),
    );

    expect(
      (await request("/flats/api/searches", { as: me, method: "POST", ...json({ name: "Again", url }) })).status,
    ).toBe(409);
    expect(SearchList.parse(await (await request("/flats/api/searches", { as: me })).json())).toContainEqual(search);
  });

  test("refuses searches from unsupported sites", async () => {
    const response = await request("/flats/api/searches", {
      as: me,
      method: "POST",
      ...json({ name: "Elsewhere", url: "https://example.com/find" }),
    });
    expect(response.status).toBe(400);
  });

  test("resuming a paused search clears its failure count", async () => {
    const search = await addSearch();
    await context.sql`update flats.searches set enabled = false, consecutive_failures = 3 where id = ${search.id}`;

    const response = await request(`/flats/api/searches/${search.id}`, {
      as: me,
      method: "PATCH",
      ...json({ enabled: true }),
    });

    expect(Search.parse(await response.json())).toMatchObject({ enabled: true, consecutiveFailures: 0 });
  });
});

describe("adding a listing by URL", () => {
  test("queues a Rightmove listing", async () => {
    await drizzle({ client: context.sql }).execute("delete from jobs.jobs where name = 'flats.add-listing'");
    const response = await request("/flats/api/listings", {
      as: me,
      method: "POST",
      ...json({ url: "https://www.rightmove.co.uk/properties/93524796#/?channel=RES_BUY" }),
    });

    expect(response.status).toBe(202);
    expect((await queuedJobs("flats.add-listing")).map((job) => job.payload)).toEqual([
      { portal: "rightmove", portalId: "93524796" },
    ]);
  });

  test("refuses other URLs", async () => {
    const response = await request("/flats/api/listings", {
      as: me,
      method: "POST",
      ...json({ url: "https://example.com/flat" }),
    });
    expect(response.status).toBe(400);
  });
});

test("history keeps only the changes", () => {
  const point = (observedAt: string, price: number, availability: "available" | "sold_stc" = "available") => ({
    observedAt,
    price,
    availability,
  });
  expect(
    collapseHistory([
      point("2026-09-01T00:00:00Z", 400000),
      point("2026-09-02T00:00:00Z", 400000),
      point("2026-09-03T00:00:00Z", 390000),
      point("2026-09-04T00:00:00Z", 390000, "sold_stc"),
    ]).map((kept) => kept.observedAt),
  ).toEqual(["2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z", "2026-09-04T00:00:00Z"]);
});

describe("destinations", () => {
  const office = { name: "Office", postcode: "wc2a1qs", arriveBy: "09:00" };

  test("saves a place by postcode and times the properties still in play to it", async () => {
    await seed();
    const union = await propertyByPortalId("93524796");
    const soldStc = await propertyByPortalId("128855633");
    await context.sql`update flats.properties set status = 'rejected', rejected_reason = 'Too far' where id = ${soldStc.property.id}`;

    const response = await request("/flats/api/destinations", { as: me, method: "POST", ...json(office) });

    expect(response.status).toBe(201);
    const created = Destination.parse(await response.json());
    expect(created).toMatchObject({ name: "Office", postcode: "WC2A 1QS", arriveBy: "09:00" });
    expect((await queuedJobs("flats.commute")).map((job) => job.payload)).toEqual([{ propertyId: union.property.id }]);
    expect(DestinationList.parse(await (await request("/flats/api/destinations", { as: me })).json())).toEqual([
      created,
    ]);

    await setup().drain();
    const list = PropertyList.parse(await (await request("/flats/api/properties?status=new", { as: me })).json());
    expect(list.find((property) => property.id === union.property.id)?.commutes).toEqual([
      { destinationId: created.id, name: "Office", minutes: 43 },
    ]);
  });

  test("refuses a postcode that does not exist or a malformed time", async () => {
    const unknown = await request("/flats/api/destinations", {
      as: me,
      method: "POST",
      ...json({ ...office, postcode: "ZZ1 1ZZ" }),
    });
    const badTime = await request("/flats/api/destinations", {
      as: me,
      method: "POST",
      ...json({ ...office, arriveBy: "9am" }),
    });

    expect(unknown.status).toBe(400);
    expect(badTime.status).toBe(400);
    expect(DestinationList.parse(await (await request("/flats/api/destinations", { as: me })).json())).toEqual([]);
  });

  test("deleting a place drops its commutes", async () => {
    await seed();
    const created = Destination.parse(
      await (await request("/flats/api/destinations", { as: me, method: "POST", ...json(office) })).json(),
    );
    await setup().drain();
    const { property } = await propertyByPortalId("93524796");
    expect(await context.sql`select 1 from flats.commutes where property_id = ${property.id}`).toHaveLength(1);

    expect((await request(`/flats/api/destinations/${created.id}`, { as: me, method: "DELETE" })).status).toBe(204);

    expect(await context.sql`select 1 from flats.commutes`).toHaveLength(0);
    expect((await request(`/flats/api/destinations/${created.id}`, { as: me, method: "DELETE" })).status).toBe(404);
  });
});
