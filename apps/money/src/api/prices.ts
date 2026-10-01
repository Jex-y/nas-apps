import { z } from "zod";

export type Candidate = { readonly symbol: string; readonly name: string };

/** Public prices for funds and shares, by FT Markets symbol (`GB00B59G4Q73:GBP`, `OCDO:LSE`). */
export type PriceSource = {
  /** Pence per unit; `null` when the symbol is unknown or not quoted in sterling. */
  readonly quote: (symbol: string, signal: AbortSignal) => Promise<number | null>;
  readonly search: (query: string, signal: AbortSignal) => Promise<readonly Candidate[]>;
};

const FT = "https://markets.ft.com/data";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The tearsheet's headline price, with the currency it is quoted in. */
const PRICE = /Price \((GBP|GBX)\)<\/span><span class="mod-ui-data-list__value">([\d,.]+)</;

const SearchResults = z.object({
  data: z.object({ security: z.array(z.object({ symbol: z.string(), name: z.string() })) }),
});

export type FtMarketsOptions = {
  /** Minimum gap between requests. */
  readonly intervalMs: number;
  readonly fetch?: typeof fetch;
};

export const createFtMarkets = ({ intervalMs, fetch: send = fetch }: FtMarketsOptions): PriceSource => {
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequest = 0;

  /** One request at a time, spaced like a person reading. */
  const get = (url: string, signal: AbortSignal): Promise<Response> => {
    const run = async () => {
      const wait = lastRequest + intervalMs - Date.now();
      if (wait > 0) {
        await Bun.sleep(wait);
      }
      lastRequest = Date.now();
      const response = await send(url, { signal, headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
      }
      return response;
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    /** Any tearsheet path redirects to the one for the symbol's asset class, and an unknown symbol to a search page. */
    quote: async (symbol, signal) => {
      const page = await (await get(`${FT}/funds/tearsheet/summary?s=${encodeURIComponent(symbol)}`, signal)).text();
      const match = PRICE.exec(page);
      const quoted = Number(match?.[2]?.replaceAll(",", ""));
      if (match === null || Number.isNaN(quoted)) {
        return null;
      }
      return match[1] === "GBP" ? quoted * 100 : quoted;
    },

    search: async (query, signal) => {
      const response = await get(`${FT}/searchapi/searchsecurities?query=${encodeURIComponent(query)}`, signal);
      return SearchResults.parse(await response.json()).data.security.map(({ symbol, name }) => ({ symbol, name }));
    },
  };
};
