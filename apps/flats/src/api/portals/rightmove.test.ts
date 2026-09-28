import { describe, expect, test } from "bun:test";
import { rightmoveListingPage as listingPage } from "../../../test/rightmove-page";
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

describe("rightmove shared ownership", () => {
  test("is read from a search result's own words, since results carry no flag", async () => {
    const search = await fixture("search.html");
    expect((await rightmove.parseSearch(search)).map((hit) => hit.sharedOwnership)).toEqual([
      false,
      false,
      false,
      false,
    ]);

    const [marked] = rightmove.parseSearch(
      search.replace('"summary":"A modern,', '"summary":"Shared Ownership: a 40% share of a modern,'),
    );
    expect(marked?.sharedOwnership).toBe(true);
  });

  test("is read from a listing's flag, then its affordable-scheme flag", () => {
    const flagged = (sharedOwnershipFlag: boolean | null, affordableBuyingScheme = false) =>
      rightmove.parseListing(listingPage({ sharedOwnership: { sharedOwnershipFlag }, affordableBuyingScheme }), "1")
        .sharedOwnership;
    expect(flagged(true)).toBe(true);
    expect(flagged(false)).toBe(false);
    expect(flagged(false, true)).toBe(true);
  });

  test("falls back to the listing's words only when the flag is missing", () => {
    const text = { description: "Offered on a shared ownership basis.", pageTitle: "1 bedroom flat for sale" };
    expect(rightmove.parseListing(listingPage({ text }), "1").sharedOwnership).toBe(true);
    expect(
      rightmove.parseListing(listingPage({ text, sharedOwnership: { sharedOwnershipFlag: false } }), "1")
        .sharedOwnership,
    ).toBe(false);
    expect(
      rightmove.parseListing(listingPage({ keyFeatures: ["Shared ownership - 25% share"] }), "1").sharedOwnership,
    ).toBe(true);
  });

  test("is not in the real fixtures", async () => {
    expect(rightmove.parseListing(await fixture("listing.html"), "93524796").sharedOwnership).toBe(false);
    expect(rightmove.parseListing(await fixture("listing-sold-stc.html"), "128855633").sharedOwnership).toBe(false);
  });

  test("is hidden from polled searches, keeping what else the search hides", () => {
    const polled = (search: string) =>
      new URL(rightmove.newestFirst(`https://www.rightmove.co.uk/property-for-sale/find.html?${search}`, 0));

    expect(polled("locationIdentifier=REGION%5E87490").searchParams.get("dontShow")).toBe("sharedOwnership");
    expect(polled("dontShow=retirement%2CnewHome").searchParams.get("dontShow")).toBe(
      "retirement,newHome,sharedOwnership",
    );
    expect(polled("dontShow=sharedOwnership%2Cretirement").searchParams.get("dontShow")).toBe(
      "sharedOwnership,retirement",
    );
  });
});
