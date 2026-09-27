export type FetchResult<T> =
  | { readonly kind: "ok"; readonly body: T }
  /** 404 or 410: the listing was taken down. */
  | { readonly kind: "gone" }
  /** 403 or 429: the portal is refusing us; back off rather than retry straight away. */
  | { readonly kind: "blocked"; readonly status: number };

export type Download = {
  readonly data: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
};

/**
 * Polite HTTP for scraping: one request at a time per host, spaced by that host's interval. Transient failures
 * (network errors, 5xx) throw, so the calling job retries with backoff.
 */
export type Fetcher = {
  readonly text: (url: string, signal: AbortSignal) => Promise<FetchResult<string>>;
  readonly bytes: (url: string, signal: AbortSignal) => Promise<FetchResult<Download>>;
};

export type FetcherOptions = {
  readonly userAgent: string;
  /** Minimum gap between requests to one host. */
  readonly intervalMs: (host: string) => number;
  readonly fetch?: typeof fetch;
};

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const createHttpFetcher = ({ userAgent, intervalMs, fetch: send = fetch }: FetcherOptions): Fetcher => {
  const queues = new Map<string, Promise<unknown>>();
  const lastRequest = new Map<string, number>();

  /** Serialises requests per host and waits out the host's interval before each one. */
  const politely = <T>(url: string, request: () => Promise<T>): Promise<T> => {
    const host = new URL(url).host;
    const run = async () => {
      const wait = (lastRequest.get(host) ?? 0) + intervalMs(host) - Date.now();
      if (wait > 0) {
        await Bun.sleep(wait);
      }
      lastRequest.set(host, Date.now());
      return request();
    };
    const next = (queues.get(host) ?? Promise.resolve()).then(run, run);
    queues.set(
      host,
      next.catch(() => undefined),
    );
    return next;
  };

  const get = <T>(url: string, signal: AbortSignal, read: (response: Response) => Promise<T>) =>
    politely(url, async (): Promise<FetchResult<T>> => {
      const response = await send(url, {
        signal,
        headers: { "User-Agent": userAgent, "Accept-Language": "en-GB,en;q=0.9" },
      });
      if (response.status === 404 || response.status === 410) {
        return { kind: "gone" };
      }
      if (response.status === 403 || response.status === 429) {
        return { kind: "blocked", status: response.status };
      }
      if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
      }
      return { kind: "ok", body: await read(response) };
    });

  return {
    text: (url, signal) => get(url, signal, (response) => response.text()),
    bytes: (url, signal) =>
      get(url, signal, async (response) => ({
        data: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("Content-Type") ?? "application/octet-stream",
      })),
  };
};
