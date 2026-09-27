import { describe, expect, test } from "bun:test";
import { ParseError } from "./listing";
import { rightmove } from "./rightmove";

const fixture = (name: string) => Bun.file(new URL(`../../../test/fixtures/rightmove/${name}`, import.meta.url)).text();

describe("rightmove search results", () => {
  test("parses each result's price, status and photos", async () => {
    const hits = await rightmove.parseSearch(await fixture("search.html"));

    expect(hits.map((hit) => hit.portalId)).toEqual(["93524796", "93631518", "91283436", "128855633"]);
    expect(hits[0]).toMatchObject({
      portal: "rightmove",
      url: "https://www.rightmove.co.uk/properties/93524796",
      address: "Union Lane, Isleworth",
      price: { amount: 350000, qualifier: "" },
      availability: "available",
      bedrooms: 2,
      bathrooms: 1,
      auction: false,
    });
    expect(hits[0]?.photos[0]?.url).toBe(
      "https://media.rightmove.co.uk/property-photo/51755b731/93524796/51755b73193e57215bd4a226942338da.jpeg",
    );
    expect(hits[3]?.availability).toBe("sold_stc");
  });

  test("rejects a page without its embedded results", () => {
    expect(() => rightmove.parseSearch("<html></html>")).toThrow(ParseError);
  });
});

describe("rightmove listing page", () => {
  test("parses the flattened page model into a listing", async () => {
    const listing = rightmove.parseListing(await fixture("listing.html"), "93524796");

    expect(listing).toMatchObject({
      availability: "available",
      address: "Union Lane, Isleworth",
      postcode: "TW7 6GH",
      outcode: "TW7",
      location: { latitude: 51.476311, longitude: -0.324446 },
      price: { amount: 350000, qualifier: "" },
      propertyType: "Apartment",
      bedrooms: 2,
      bathrooms: 1,
      sizeSqft: 656,
      tenure: "leasehold",
      leaseYearsRemaining: 107,
      annualServiceCharge: 3650.64,
      annualGroundRent: 300,
      councilTaxBand: "D",
      sharedOwnership: false,
      agent: { name: "Chase Buchanan, Isleworth & Osterley", phone: "020 3909 6457" },
    });
    expect(listing.description).toStartWith("A modern, spacious and beautifully presented");
    expect(listing.description).not.toContain("<br");
    expect(listing.keyFeatures).toContain("Heating & hot water included");
    expect(listing.photos).toHaveLength(10);
    expect(listing.floorplans).toHaveLength(1);
    expect(listing.nearestStations[0]).toEqual({ name: "Syon Lane Station", miles: expect.closeTo(0.379, 3) });
  });

  test("reads Sold STC from the listing's tags", async () => {
    const listing = rightmove.parseListing(await fixture("listing-sold-stc.html"), "128855633");
    expect(listing.availability).toBe("sold_stc");
    expect(listing.price.amount).toBe(450000);
  });

  test("rejects a page without the page model", () => {
    expect(() => rightmove.parseListing("<html></html>", "1")).toThrow(ParseError);
  });
});

describe("rightmove urls", () => {
  test("forces newest-first order and the page offset onto a saved search", () => {
    const url = new URL(
      rightmove.newestFirst(
        "https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E87490&maxPrice=600000&sortType=2",
        24,
      ),
    );
    expect(url.searchParams.get("sortType")).toBe("6");
    expect(url.searchParams.get("index")).toBe("24");
    expect(url.searchParams.get("locationIdentifier")).toBe("REGION^87490");
    expect(url.searchParams.get("maxPrice")).toBe("600000");
  });

  test("refuses to search anywhere but Rightmove", () => {
    expect(() => rightmove.newestFirst("https://example.com/find.html", 0)).toThrow();
  });

  test("recognises listing urls", () => {
    expect(rightmove.portalIdFromUrl("https://www.rightmove.co.uk/properties/93524796#/?channel=RES_BUY")).toBe(
      "93524796",
    );
    expect(rightmove.portalIdFromUrl("https://www.zoopla.co.uk/for-sale/details/1234")).toBeNull();
  });
});

/** Encodes a value in Rightmove's flattened page-model format: every nested value becomes an index. */
const flatten = (root: unknown): unknown[] => {
  const flat: unknown[] = [];
  const add = (value: unknown): number => {
    const index = flat.length;
    flat.push(null);
    if (Array.isArray(value)) {
      flat[index] = value.map(add);
    } else if (value !== null && typeof value === "object") {
      flat[index] = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, add(inner)]));
    } else {
      flat[index] = value;
    }
    return index;
  };
  add(root);
  return flat;
};

const listingPage = (overrides: Record<string, unknown>) => {
  const propertyData = {
    status: { archived: false },
    tags: [],
    text: { description: "A flat. 125 years remaining on the lease." },
    prices: { primaryPrice: "£400,000", displayPriceQualifier: "" },
    address: { displayAddress: "Somewhere, London", outcode: "E8", incode: "1AA" },
    tenure: { tenureType: "LEASEHOLD", yearsRemainingOnLease: 0 },
    livingCosts: { annualServiceCharge: 0, annualGroundRent: 0, councilTaxBand: "TBC" },
    ...overrides,
  };
  const model = { data: JSON.stringify(flatten({ propertyData })), encoding: "on" };
  return `<script>window.__PAGE_MODEL = ${JSON.stringify(model)};window.adInfo = {};</script>`;
};

describe("rightmove placeholders", () => {
  test("reads zero lease and service charge and a TBC band as not stated", () => {
    const listing = rightmove.parseListing(listingPage({}), "1");
    expect(listing).toMatchObject({
      leaseYearsRemaining: 125,
      annualServiceCharge: null,
      annualGroundRent: 0,
      councilTaxBand: null,
    });
  });

  test("keeps a stated band, normalised", () => {
    const listing = rightmove.parseListing(
      listingPage({ livingCosts: { annualServiceCharge: 1200, annualGroundRent: 250, councilTaxBand: " c " } }),
      "1",
    );
    expect(listing).toMatchObject({ annualServiceCharge: 1200, annualGroundRent: 250, councilTaxBand: "C" });
  });
});
