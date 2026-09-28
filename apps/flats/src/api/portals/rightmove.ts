import { z } from "zod";
import { extractAssignedJson, unflatten } from "./flattened";
import { decodeEntities, htmlToText } from "./html-text";
import {
  type Availability,
  mentionsSharedOwnership,
  type ParsedListing,
  ParseError,
  type PortalParser,
  type Price,
  type SearchHit,
  type Tenure,
} from "./listing";

const ORIGIN = "https://www.rightmove.co.uk";
const MEDIA = "https://media.rightmove.co.uk";
/** Rightmove's "newest listed" search order. */
const NEWEST_FIRST = "6";
/** A value of the comma-separated `dontShow` search parameter, alongside e.g. `retirement` and `newHome`. */
const HIDE_SHARED_OWNERSHIP = "sharedOwnership";

const parse = <S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ParseError(`Rightmove ${what} changed shape:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

const availabilityFromStatus = (status: string | null | undefined): Availability => {
  const normalised = status?.toLowerCase() ?? "";
  if (normalised.includes("sold")) {
    return "sold_stc";
  }
  if (normalised.includes("under offer") || normalised.includes("reserved")) {
    return "under_offer";
  }
  return "available";
};

const availabilityFromTags = (tags: readonly string[], archived: boolean): Availability => {
  if (archived) {
    return "removed";
  }
  if (tags.some((tag) => tag.startsWith("SOLD"))) {
    return "sold_stc";
  }
  if (tags.some((tag) => tag === "UNDER_OFFER" || tag === "RESERVED")) {
    return "under_offer";
  }
  return "available";
};

const TENURES: Readonly<Record<string, Tenure>> = {
  FREEHOLD: "freehold",
  LEASEHOLD: "leasehold",
  SHARE_OF_FREEHOLD: "share_of_freehold",
  COMMONHOLD: "commonhold",
};

const tenureFrom = (tenureType: string | null | undefined): Tenure => TENURES[tenureType ?? ""] ?? "unknown";

const priceFromDisplay = (display: string, qualifier: string | null | undefined): Price => {
  const digits = display.replace(/[^0-9]/g, "");
  return { amount: digits === "" ? null : Number(digits), qualifier: qualifier?.trim() ?? "" };
};

/** Rightmove fills unknown amounts with 0; a zero lease or service charge on a listing means "not stated". */
const statedAmount = (value: number | null | undefined): number | null =>
  value === null || value === undefined || value === 0 ? null : value;

/** "TBC" and blanks mean the council tax band is not known yet. */
const statedBand = (band: string | null | undefined): string | null =>
  band === null || band === undefined || !/^[A-I]$/i.test(band.trim()) ? null : band.trim().toUpperCase();

const LEASE_IN_TEXT = /(\d{2,3})\s*(?:-\s*)?(?:years?|yrs?)\s+(?:remaining|left|unexpired|on the lease)/i;

const leaseFromText = (text: string): number | null => {
  const match = LEASE_IN_TEXT.exec(text);
  return match?.[1] === undefined ? null : Number(match[1]);
};

const SearchProperty = z.object({
  id: z.number(),
  bedrooms: z.number().nullish(),
  bathrooms: z.number().nullish(),
  displayAddress: z.string(),
  displayStatus: z.string().nullish(),
  auction: z.boolean().nullish(),
  propertyTypeFullDescription: z.string().nullish(),
  summary: z.string().nullish(),
  keyFeatures: z.array(z.object({ description: z.string() })).nullish(),
  price: z.object({
    amount: z.number().nullish(),
    displayPrices: z.array(z.object({ displayPriceQualifier: z.string().nullish() })),
  }),
  images: z.array(z.object({ url: z.string(), caption: z.string().nullish() })),
});

const SearchPage = z.object({
  props: z.object({
    pageProps: z.object({ searchResults: z.object({ properties: z.array(SearchProperty) }) }),
  }),
});

const NEXT_DATA = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;

const parseSearch = (html: string): readonly SearchHit[] => {
  const json = NEXT_DATA.exec(html)?.[1];
  if (json === undefined) {
    throw new ParseError("Rightmove search page has no __NEXT_DATA__");
  }
  const page = parse(SearchPage, JSON.parse(json), "search results");
  return page.props.pageProps.searchResults.properties.map((property) => ({
    portal: "rightmove",
    portalId: String(property.id),
    url: listingUrl(String(property.id)),
    address: property.displayAddress,
    price: {
      amount: property.price.amount ?? null,
      qualifier: property.price.displayPrices[0]?.displayPriceQualifier?.trim() ?? "",
    },
    availability: availabilityFromStatus(property.displayStatus),
    bedrooms: property.bedrooms ?? null,
    bathrooms: property.bathrooms ?? null,
    auction: property.auction ?? false,
    sharedOwnership: mentionsSharedOwnership(
      property.propertyTypeFullDescription ?? "",
      property.summary ?? "",
      ...(property.keyFeatures ?? []).map((feature) => feature.description),
    ),
    photos: property.images.map((image) => ({ url: `${MEDIA}/${image.url}`, caption: image.caption ?? "" })),
  }));
};

const Image = z.object({ url: z.string(), caption: z.string().nullish() });

const PropertyData = z.object({
  status: z.object({ archived: z.boolean() }),
  tags: z.array(z.string()).nullish(),
  text: z.object({ description: z.string(), pageTitle: z.string().nullish() }),
  prices: z.object({ primaryPrice: z.string(), displayPriceQualifier: z.string().nullish() }),
  address: z.object({ displayAddress: z.string(), outcode: z.string().nullish(), incode: z.string().nullish() }),
  location: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
  keyFeatures: z.array(z.string()).nullish(),
  images: z.array(Image).nullish(),
  floorplans: z.array(Image).nullish(),
  nearestStations: z.array(z.object({ name: z.string(), distance: z.number(), unit: z.string() })).nullish(),
  sizings: z.array(z.object({ unit: z.string(), minimumSize: z.number() })).nullish(),
  bedrooms: z.number().nullish(),
  bathrooms: z.number().nullish(),
  propertySubType: z.string().nullish(),
  tenure: z.object({ tenureType: z.string().nullish(), yearsRemainingOnLease: z.number().nullish() }).nullish(),
  livingCosts: z
    .object({
      annualServiceCharge: z.number().nullish(),
      annualGroundRent: z.number().nullish(),
      councilTaxBand: z.string().nullish(),
    })
    .nullish(),
  sharedOwnership: z.object({ sharedOwnershipFlag: z.boolean().nullish() }).nullish(),
  affordableBuyingScheme: z.boolean().nullish(),
  customer: z.object({ branchDisplayName: z.string().nullish() }).nullish(),
  contactInfo: z.object({ telephoneNumbers: z.object({ localNumber: z.string().nullish() }).nullish() }).nullish(),
});

const ListingPage = z.object({ data: z.string() });

const MILES_PER_KM = 0.621371;

const parseListing = (html: string, portalId: string): ParsedListing => {
  const model = extractAssignedJson(html, "window.__PAGE_MODEL = ");
  if (model === undefined) {
    throw new ParseError("Rightmove listing page has no __PAGE_MODEL");
  }
  const root = unflatten(JSON.parse(parse(ListingPage, model, "listing page").data));
  const property = parse(z.object({ propertyData: PropertyData }), root, "listing").propertyData;

  const description = htmlToText(property.text.description);
  const outcode = property.address.outcode ?? null;
  const incode = property.address.incode ?? null;
  const agentName = property.customer?.branchDisplayName ?? null;
  const keyFeatures = (property.keyFeatures ?? []).map(decodeEntities);

  return {
    portal: "rightmove",
    portalId,
    url: listingUrl(portalId),
    availability: availabilityFromTags(property.tags ?? [], property.status.archived),
    address: property.address.displayAddress,
    postcode: outcode !== null && incode !== null ? `${outcode} ${incode}` : null,
    outcode,
    location: property.location ?? null,
    price: priceFromDisplay(property.prices.primaryPrice, property.prices.displayPriceQualifier),
    propertyType: property.propertySubType ?? "",
    bedrooms: property.bedrooms ?? null,
    bathrooms: property.bathrooms ?? null,
    sizeSqft: property.sizings?.find((sizing) => sizing.unit === "sqft")?.minimumSize ?? null,
    tenure: tenureFrom(property.tenure?.tenureType),
    leaseYearsRemaining: statedAmount(property.tenure?.yearsRemainingOnLease) ?? leaseFromText(description),
    annualServiceCharge: statedAmount(property.livingCosts?.annualServiceCharge),
    annualGroundRent: property.livingCosts?.annualGroundRent ?? null,
    councilTaxBand: statedBand(property.livingCosts?.councilTaxBand),
    sharedOwnership:
      (property.sharedOwnership?.sharedOwnershipFlag ??
        mentionsSharedOwnership(property.text.pageTitle ?? "", description, ...keyFeatures)) ||
      (property.affordableBuyingScheme ?? false),
    description,
    keyFeatures,
    photos: (property.images ?? []).map((image) => ({ url: image.url, caption: image.caption ?? "" })),
    floorplans: (property.floorplans ?? []).map((image) => ({ url: image.url, caption: image.caption ?? "" })),
    nearestStations: (property.nearestStations ?? []).map((station) => ({
      name: station.name,
      miles: station.unit === "km" ? station.distance * MILES_PER_KM : station.distance,
    })),
    agent:
      agentName === null
        ? null
        : { name: agentName, phone: property.contactInfo?.telephoneNumbers?.localNumber ?? null },
  };
};

const listingUrl = (portalId: string): string => `${ORIGIN}/properties/${portalId}`;

const LISTING_URL = /^https:\/\/(?:www\.)?rightmove\.co\.uk\/properties\/(\d+)/;

export const rightmove: PortalParser = {
  portal: "rightmove",
  newestFirst: (searchUrl, offset) => {
    const url = new URL(searchUrl);
    if (!/(^|\.)rightmove\.co\.uk$/.test(url.hostname)) {
      throw new Error(`Not a Rightmove URL: ${searchUrl}`);
    }
    url.searchParams.set("sortType", NEWEST_FIRST);
    url.searchParams.set("index", String(offset));
    const hidden = (url.searchParams.get("dontShow") ?? "").split(",").filter(Boolean);
    url.searchParams.set("dontShow", [...new Set([...hidden, HIDE_SHARED_OWNERSHIP])].join(","));
    return url.toString();
  },
  listingUrl,
  portalIdFromUrl: (url) => LISTING_URL.exec(url)?.[1] ?? null,
  parseSearch,
  parseListing,
};
