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

/** A minimal Rightmove listing page, with `overrides` replacing top-level fields of its property data. */
export const rightmoveListingPage = (overrides: Record<string, unknown>) => {
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

/** Rightmove's reply when asked what a property sold for before, newest first. */
export const saleHistory = (...sales: readonly (readonly [year: number, soldPrice: string])[]) =>
  JSON.stringify({
    soldPropertyTransactions: sales.map(([year, soldPrice]) => ({
      year: String(year),
      soldPrice,
      percentageChange: "",
    })),
    disclaimer: "Source acknowledgement: House price data produced by the Land Registry",
  });
