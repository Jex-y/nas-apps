import { describe, expect, test } from "bun:test";
import { createBlobStore } from "@apps/core";
import { callTool, connectMcp, startTestServer, uniqueLogin } from "@apps/core/testing";
import { createFlatsTestbed, fakeExtractor, fakeGeocoder, fakePlanner } from "../../test/support";
import { createFlatsApp } from "../module";
import { DEFAULT_REQUIREMENTS } from "./requirements";

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
const connect = () => connectMcp(request, "/flats/mcp", me);

const seed = async () => {
  const { work, drain } = setup();
  await work.backfillSearch((await addSearch()).id, 1);
  await drain();
};

const json = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await callTool(await connect(), name, args);
  expect(result.isError).toBe(false);
  return JSON.parse(result.text);
};

describe("flats mcp", () => {
  test("offers a tool for everything the web app does", async () => {
    const { tools } = await (await connect()).listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_destination",
      "add_listing",
      "add_search",
      "add_viewing",
      "delete_destination",
      "delete_search",
      "delete_viewing",
      "delete_viewing_photo",
      "get_property",
      "get_requirements",
      "list_destinations",
      "list_properties",
      "list_searches",
      "save_requirements",
      "set_property_notes",
      "set_property_status",
      "set_search_enabled",
      "try_requirements",
      "view_photo",
      "view_viewing_photo",
    ]);
  });

  test("lists properties briefly, and reads one in full with its photos by id", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");

    const listed = await json("list_properties", { status: "new" });
    expect(listed).toHaveLength(4);
    expect(listed).toContainEqual(
      expect.objectContaining({
        id: property.id,
        address: "Union Lane, Isleworth",
        price: 350000,
        ranking: { score: expect.any(Number) },
        urls: ["https://www.rightmove.co.uk/properties/93524796"],
      }),
    );
    expect(await json("list_properties", { status: "shortlisted" })).toEqual([]);

    const detail = await json("get_property", { propertyId: property.id });
    expect(detail.keyFeatures).toContain("Private balcony");
    expect(detail.ranking.contributions).toContainEqual({
      key: "outdoor_space",
      source: "jev",
      label: "Outdoor space",
      detail: "Private garden",
      points: 3,
    });
    expect(detail.photos[0]).toEqual({ id: expect.any(String), kind: "photo" });
    expect(detail).not.toHaveProperty("thumbnailUrl");
  });

  test("shows a listing photo as an image", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");
    const [photo] = (await json("get_property", { propertyId: property.id })).photos;
    await createBlobStore(context.blob, "flats").write(`photos/${photo.id}`, new Blob(["jpeg"]), "image/jpeg");

    const result = await (await connect()).callTool({ name: "view_photo", arguments: { photoId: photo.id } });

    expect(result.content).toEqual([{ type: "image", data: btoa("jpeg"), mimeType: "image/jpeg" }]);
  });

  test("rejects a property with a reason, and records a viewing as the connected person", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");

    expect(
      await json("set_property_status", { propertyId: property.id, status: "rejected", reason: "Too far out" }),
    ).toMatchObject({ status: "rejected", rejectedReason: "Too far out" });
    expect(await json("set_property_status", { propertyId: property.id, status: "viewed" })).toMatchObject({
      status: "viewed",
      rejectedReason: null,
    });

    const { viewings } = await json("add_viewing", {
      propertyId: property.id,
      at: "2026-09-30T18:30:00+01:00",
      rating: 4,
      notes: "Bright",
    });
    expect(viewings).toEqual([expect.objectContaining({ rating: 4, createdBy: me, photos: [] })]);
  });

  test("tries a draft of the requirements without saving it", async () => {
    await seed();
    const { property } = await propertyByPortalId("93524796");
    const draft = { ...DEFAULT_REQUIREMENTS, limits: { ...DEFAULT_REQUIREMENTS.limits, minSizeSqft: 5000 } };

    const trial = await json("try_requirements", { requirements: draft, propertyId: property.id });

    expect(trial.rejectedBy).toBe("Under 5,000 sq ft");
    expect(await json("get_requirements")).toEqual(DEFAULT_REQUIREMENTS);
  });

  test("hands refusals back as tool errors", async () => {
    const client = await connect();

    expect(await callTool(client, "get_property", { propertyId: crypto.randomUUID() })).toEqual({
      isError: true,
      text: "Not found",
    });
    expect(await callTool(client, "add_listing", { url: "https://example.com/flat" })).toEqual({
      isError: true,
      text: "That is not a listing URL from a supported portal",
    });
  });
});
