import { join } from "node:path";
import { type AppEntry, REPO_ROOT, type ShellEntry } from "./server";

export type PageTarget =
  | { readonly kind: "ready"; readonly name: string; readonly path: string }
  | { readonly kind: "unresolved"; readonly name: string; readonly pattern: string; readonly reason: string };

/** A route with a parameter is shot once, for the first record its API lists. Keyed by `<slug><route pattern>`. */
const PARAM_SOURCES: Readonly<Record<string, string>> = {
  "flats/properties/:id": "/flats/api/properties",
  "tasks/task/:taskId": "/tasks/api/tasks",
};

type RouteDecl = { readonly pattern: string; readonly component: string | null };

const ROUTE = /<Route\s+path="([^"]+)"(?:\s+component=\{(\w+)\})?[^>]*>/g;
const FIRST_PAGE = /<(\w+)Page\b/;

/** Reads `<Route path=…>` from every file of an app's UI, so the list follows the router rather than a copy of it. */
const routeDecls = async (slug: string): Promise<readonly RouteDecl[]> => {
  const cwd = join(REPO_ROOT, "apps", slug, "src/web");
  const files = await Array.fromAsync(new Bun.Glob("**/*.tsx").scan({ cwd }));
  const sources = await Promise.all(files.sort().map((file) => Bun.file(join(cwd, file)).text()));
  return sources.flatMap((source) =>
    [...source.matchAll(ROUTE)].map((match) => {
      const pattern = match[1] ?? "/";
      const inline = match[2]?.replace(/Page$/, "");
      const child = FIRST_PAGE.exec(source.slice((match.index ?? 0) + match[0].length).slice(0, 300))?.[1];
      return { pattern, component: inline ?? child ?? null };
    }),
  );
};

const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** The last static segment names a page (`/commutes` → commutes); the component names `/` and parameter routes. */
const pageName = (slug: string, { pattern, component }: RouteDecl): string => {
  const segments = pattern.split("/").filter((segment) => segment !== "");
  const last = segments.at(-1);
  const fromPath = last !== undefined && !last.startsWith(":") ? last : null;
  const name = fromPath ?? (component === null ? segments.join("-").replace(/:/g, "") || "index" : kebab(component));
  return `${slug}-${name}`;
};

const firstId = async (base: URL, apiPath: string): Promise<string | null> => {
  const response = await fetch(new URL(apiPath, base));
  if (!response.ok) {
    return null;
  }
  const rows: unknown = await response.json();
  const first = Array.isArray(rows) ? rows[0] : undefined;
  return typeof first === "object" && first !== null && "id" in first && typeof first.id === "string" ? first.id : null;
};

const resolve = async (base: URL, slug: string, decl: RouteDecl): Promise<PageTarget> => {
  const name = pageName(slug, decl);
  const pattern = `/${slug}${decl.pattern === "/" ? "/" : decl.pattern}`;
  const params = decl.pattern.match(/:\w+/g) ?? [];
  if (params.length === 0) {
    return { kind: "ready", name, path: pattern };
  }
  const source = PARAM_SOURCES[`${slug}${decl.pattern}`];
  if (source === undefined || params.length !== 1) {
    return { kind: "unresolved", name, pattern, reason: "no entry in PARAM_SOURCES (scripts/ui-harness/pages.ts)" };
  }
  const id = await firstId(base, source);
  return id === null
    ? { kind: "unresolved", name, pattern, reason: `${source} listed no records` }
    : { kind: "ready", name, path: pattern.replace(/:\w+/, id) };
};

const shellName = (path: string) => (path === "/" ? "shell-launcher" : `shell-${path.split("/").at(-1)}`);

/** Every page the worktree serves, with parameter routes filled in from the deployed data (fetched via the harness). */
export const discoverPages = async (
  base: URL,
  apps: readonly AppEntry[],
  shellPages: readonly ShellEntry[],
): Promise<readonly PageTarget[]> => {
  const shell: PageTarget[] = shellPages.map(({ path }) => ({ kind: "ready", name: shellName(path), path }));
  const perApp = await Promise.all(
    apps.map(async ({ slug }) => {
      const decls = await routeDecls(slug);
      return decls.length === 0
        ? [{ kind: "ready", name: slug, path: `/${slug}/` } satisfies PageTarget]
        : Promise.all(decls.map((decl) => resolve(base, slug, decl)));
    }),
  );
  return [...shell, ...perApp.flat()];
};

/** `--path /flats/board?x=1` → `flats-board-x-1`. */
export const adHocPage = (path: string): PageTarget => ({
  kind: "ready",
  name: path.replace(/^\/|\/$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") || "root",
  path,
});
