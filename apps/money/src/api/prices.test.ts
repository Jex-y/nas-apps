import { describe, expect, test } from "bun:test";
import { createFtMarkets } from "./prices";

const tearsheet = (currency: string, price: string) =>
  `<ul class="mod-ui-data-list"><li><span class="mod-ui-data-list__label" title="NAV.">Price (${currency})</span><span class="mod-ui-data-list__value">${price}</span></li><li><span class="mod-ui-data-list__label">Today's Change</span><span class="mod-ui-data-list__value">1.20</span></li></ul>`;

const fakeFt = (pages: Readonly<Record<string, Response>>) => {
  const requested: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return pages[String(input)]?.clone() ?? new Response("Not found", { status: 404, statusText: "Not Found" });
  }) as typeof globalThis.fetch;
  return { prices: createFtMarkets({ intervalMs: 0, fetch }), requested };
};

const signal = AbortSignal.timeout(5_000);
const SUMMARY = "https://markets.ft.com/data/funds/tearsheet/summary?s=";

describe("FT Markets", () => {
  test("quotes pence per unit whether FT prices in pounds or pence, and nothing in another currency", async () => {
    const { prices } = fakeFt({
      [`${SUMMARY}GB00B59G4Q73%3AGBP`]: new Response(tearsheet("GBP", "1,924.77")),
      [`${SUMMARY}OCDO%3ALSE`]: new Response(tearsheet("GBX", "255.60")),
      [`${SUMMARY}MSFT%3ANSQ`]: new Response(tearsheet("USD", "512.90")),
      [`${SUMMARY}NOPE%3AGBP`]: new Response("<h1>Search results</h1>"),
    });

    expect(await prices.quote("GB00B59G4Q73:GBP", signal)).toBeCloseTo(192477, 6);
    expect(await prices.quote("OCDO:LSE", signal)).toBe(255.6);
    expect(await prices.quote("MSFT:NSQ", signal)).toBeNull();
    expect(await prices.quote("NOPE:GBP", signal)).toBeNull();
  });

  test("fails when FT is down, so the job retries rather than taking it for an unknown symbol", async () => {
    const { prices } = fakeFt({});

    expect(prices.quote("OCDO:LSE", signal)).rejects.toThrow("failed: 404 Not Found");
  });

  test("searches by name or code", async () => {
    const { prices, requested } = fakeFt({
      "https://markets.ft.com/data/searchapi/searchsecurities?query=Ocado%20Group": Response.json({
        data: {
          security: [
            { symbol: "OCDO:LSE", name: "Ocado Group PLC", assetClass: "Equities", isPrimary: true },
            { symbol: "0OC:FRA", name: "Ocado Group PLC", assetClass: "Equities", isPrimary: false },
          ],
        },
      }),
    });

    expect(await prices.search("Ocado Group", signal)).toEqual([
      { symbol: "OCDO:LSE", name: "Ocado Group PLC" },
      { symbol: "0OC:FRA", name: "Ocado Group PLC" },
    ]);
    expect(requested).toHaveLength(1);
  });
});
