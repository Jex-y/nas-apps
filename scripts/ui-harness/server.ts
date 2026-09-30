import { basename, join } from "node:path";
import { resolveUpstream } from "./upstream";

/**
 * Serves the worktree's own HTML entry points (bundled by Bun exactly as `bun run dev` does) and forwards data
 * requests to the deployed stack. Only GET and HEAD ever leave the machine; every other method is answered here.
 */
export const REPO_ROOT = join(import.meta.dir, "../..");
const SHELL_DIR = join(REPO_ROOT, "packages/core/src/shell");

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** The shell re-registers an existing push subscription on every visit; a 405 there would surface as a page error. */
const HARMLESS_WRITES: ReadonlySet<string> = new Set(["POST /shell/api/push/subscriptions"]);

/** Paths that are data, not pages. A page path the worktree lacks must 404 here, never render production's HTML. */
const isUpstreamPath = (pathname: string): boolean =>
  /^\/[a-z0-9-]+\/api\//.test(pathname) || pathname.startsWith("/shell/icons/") || pathname === "/manifest.webmanifest";

const FORWARDED_REQUEST_HEADERS = ["accept", "accept-language", "if-none-match", "if-modified-since", "range"];

export type RefusedRequest = { readonly method: string; readonly path: string };

export type AppEntry = { readonly slug: string; readonly page: Bun.HTMLBundle };
export type ShellEntry = { readonly path: string; readonly page: Bun.HTMLBundle };

export type HarnessServer = {
  readonly url: URL;
  readonly upstream: URL;
  readonly apps: readonly AppEntry[];
  readonly shellPages: readonly ShellEntry[];
  /** Writes the pages attempted, answered locally; a snapshot, newest last. */
  readonly refused: () => readonly RefusedRequest[];
  readonly stop: () => Promise<void>;
};

const importPage = async (file: string): Promise<Bun.HTMLBundle> => (await import(file)).default;

const discoverApps = async (): Promise<readonly AppEntry[]> => {
  const files = await Array.fromAsync(new Bun.Glob("apps/*/src/web/index.html").scan({ cwd: REPO_ROOT }));
  return Promise.all(
    files.sort().map(async (file) => ({
      slug: file.split("/")[1] ?? file,
      page: await importPage(join(REPO_ROOT, file)),
    })),
  );
};

/** `index.html` is the launcher at `/`; any other `<name>.html` is served at `/shell/<name>`, as the shell does. */
const discoverShellPages = async (): Promise<readonly ShellEntry[]> => {
  const files = await Array.fromAsync(new Bun.Glob("*.html").scan({ cwd: SHELL_DIR }));
  return Promise.all(
    files.sort().map(async (file) => ({
      path: file === "index.html" ? "/" : `/shell/${basename(file, ".html")}`,
      page: await importPage(join(SHELL_DIR, file)),
    })),
  );
};

const forward = async (upstream: URL, request: Request, pathname: string, search: string): Promise<Response> => {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  const response = await fetch(new URL(`${pathname}${search}`, upstream), {
    method: request.method,
    headers,
    redirect: "manual",
  });
  // fetch has already decoded the body, so the upstream encoding and length no longer describe it.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("set-cookie");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

export type HarnessOptions = {
  readonly upstream: URL;
  readonly port?: number;
  readonly hmr?: boolean;
};

export const startHarnessServer = async ({
  upstream,
  port = 0,
  hmr = false,
}: HarnessOptions): Promise<HarnessServer> => {
  const [apps, shellPages] = await Promise.all([discoverApps(), discoverShellPages()]);
  const refused: RefusedRequest[] = [];

  const handle = (request: Request): Promise<Response> | Response => {
    const { pathname, search } = new URL(request.url);
    if (!READ_METHODS.has(request.method)) {
      const key = `${request.method} ${pathname}`;
      refused.push({ method: request.method, path: pathname });
      return HARMLESS_WRITES.has(key)
        ? new Response(null, { status: 204 })
        : Response.json({ error: `ui-harness is read-only: ${key} was not forwarded` }, { status: 405 });
    }
    if (!isUpstreamPath(pathname)) {
      return Response.json({ error: "Not found in this worktree" }, { status: 404 });
    }
    return forward(upstream, request, pathname, search);
  };

  const pageRoutes = Object.fromEntries([
    ...shellPages.map(({ path, page }) => [path, { GET: page }] as const),
    ...apps.flatMap(({ slug, page }) => [
      [`/${slug}`, { GET: new Response(null, { status: 308, headers: { Location: `/${slug}/` } }) }] as const,
      [`/${slug}/*`, { GET: page }] as const,
      [`/${slug}/api/*`, handle] as const,
    ]),
  ]);

  // Page routes answer GET only, so any other method on a page path falls through to `handle` and is refused.
  const server = Bun.serve({
    port,
    development: { hmr, console: false },
    routes: {
      ...pageRoutes,
      "/sw.js": {
        GET: () =>
          new Response(Bun.file(join(SHELL_DIR, "sw.js")), {
            headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
          }),
      },
    },
    fetch: handle,
  });

  return {
    url: new URL(server.url.href),
    upstream,
    apps,
    shellPages,
    refused: () => [...refused],
    stop: () => server.stop(true),
  };
};

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4173);
  const harness = await startHarnessServer({ upstream: resolveUpstream(process.env), port, hmr: true });
  console.log(`ui-harness serving ${REPO_ROOT} pages at ${harness.url}`);
  console.log(`  data (GET/HEAD only) from ${harness.upstream}`);
}
