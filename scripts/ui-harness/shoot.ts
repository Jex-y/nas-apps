import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, type BrowserContextOptions, chromium } from "playwright-core";
import { THEMES as THEME_OPTIONS, type ThemeId } from "../../packages/core/src/web/theme";
import { renderContactSheet } from "./contact-sheet";
import { adHocPage, discoverPages, type PageTarget } from "./pages";
import { startHarnessServer } from "./server";
import { resolveUpstream } from "./upstream";

/**
 * bun scripts/ui-harness/shoot.ts [--pages flats,shell-settings] [--path /flats/board] [--themes glass,drafting]
 *   [--schemes light,dark] [--viewports desktop,phone] [--out <dir>]
 *
 * Writes PNGs, an index.html contact sheet and manifest.json to <out>/<timestamp>/.
 */
const THEMES: readonly ThemeId[] = THEME_OPTIONS.map(({ id }) => id);
const SCHEMES = ["light", "dark"] as const;
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
} as const satisfies Record<string, BrowserContextOptions>;

type Scheme = (typeof SCHEMES)[number];
type ViewportName = keyof typeof VIEWPORTS;

export type Variant = { readonly theme: ThemeId; readonly scheme: Scheme; readonly viewport: ViewportName };

export type ShotOutcome =
  | { readonly kind: "captured"; readonly file: string; readonly appliedTheme: string | null }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "failed"; readonly message: string };

export type ShotRecord = {
  readonly page: string;
  readonly path: string;
  readonly variant: Variant;
  readonly outcome: ShotOutcome;
  readonly consoleErrors: readonly string[];
  readonly failedRequests: readonly string[];
};

const DEFAULT_OUT = join(tmpdir(), "ui-shots");
const PARALLEL_CONTEXTS = 4;

const STILL_CSS = `*, *::before, *::after {
  animation: none !important; transition: none !important; caret-color: transparent !important;
}`;

const pick = <T extends string>(label: string, all: readonly T[], raw: string | undefined): readonly T[] => {
  if (raw === undefined) {
    return all;
  }
  const chosen = raw.split(",").map((value) => value.trim());
  const unknown = chosen.filter((value) => !all.includes(value as T));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${label}: ${unknown.join(", ")} (choose from ${all.join(", ")})`);
  }
  return chosen as T[];
};

const { values: args } = parseArgs({
  options: {
    pages: { type: "string" },
    path: { type: "string" },
    themes: { type: "string" },
    schemes: { type: "string" },
    viewports: { type: "string" },
    out: { type: "string" },
  },
});

const variants: readonly Variant[] = pick("theme", THEMES, args.themes).flatMap((theme) =>
  pick("scheme", SCHEMES, args.schemes).flatMap((scheme) =>
    pick("viewport", Object.keys(VIEWPORTS) as ViewportName[], args.viewports).map((viewport) => ({
      theme,
      scheme,
      viewport,
    })),
  ),
);

/** `--pages flats,shell-settings` keeps a whole app by slug, or one page by its full name. */
const selectPages = (pages: readonly PageTarget[], raw: string | undefined): readonly PageTarget[] => {
  if (raw === undefined) {
    return pages;
  }
  const wanted = raw.split(",").map((value) => value.trim());
  return pages.filter(({ name }) => wanted.some((want) => name === want || name.startsWith(`${want}-`)));
};

const shoot = async (
  browser: Browser,
  base: URL,
  outDir: string,
  variant: Variant,
  pages: readonly Extract<PageTarget, { kind: "ready" }>[],
): Promise<readonly ShotRecord[]> => {
  const context = await browser.newContext({
    ...VIEWPORTS[variant.viewport],
    colorScheme: variant.scheme,
    reducedMotion: "reduce",
    baseURL: base.href,
  });
  await context.addInitScript((theme) => localStorage.setItem("theme", theme), variant.theme);
  // Headless Chromium otherwise reports notifications as blocked; granting only changes what the settings page says.
  await context.grantPermissions(["notifications"], { origin: base.origin });

  const shootOnce = async (target: (typeof pages)[number]): Promise<ShotRecord> => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: variant.scheme, reducedMotion: "reduce" });
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
      // Chromium probes /favicon.ico on every page; the stack serves none, in production too.
      if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(`uncaught: ${error.message}`));
    page.on("requestfailed", (request) =>
      failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`),
    );
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedRequests.push(`${response.request().method()} ${response.url()} — HTTP ${response.status()}`);
      }
    });
    const record = (outcome: ShotOutcome): ShotRecord => ({
      page: target.name,
      path: target.path,
      variant,
      outcome,
      consoleErrors,
      failedRequests,
    });
    try {
      const response = await page.goto(target.path, { waitUntil: "networkidle", timeout: 30_000 });
      if (response !== null && !response.ok()) {
        return record({ kind: "http-error", status: response.status() });
      }
      await page.addStyleTag({ content: STILL_CSS });
      // A full-page shot never scrolls, so lazy images below the fold would stay blank.
      await page.evaluate(async () => {
        const images = [...document.images];
        for (const image of images) {
          image.loading = "eager";
        }
        await Promise.all([
          document.fonts.ready,
          ...images.map((image) => (image.complete ? null : image.decode().catch(() => undefined))),
        ]);
      });
      const file = `${target.name}__${variant.theme}__${variant.scheme}__${variant.viewport}.png`;
      await page.screenshot({ path: join(outDir, file), fullPage: true, animations: "disabled" });
      const appliedTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
      return record({ kind: "captured", file, appliedTheme });
    } catch (error) {
      return record({
        kind: "failed",
        message: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
      });
    } finally {
      await page.close();
    }
  };

  const results: ShotRecord[] = [];
  for (const target of pages) {
    const first = await shootOnce(target);
    // A page mid-edit can fail to bundle; one retry separates that from a real failure.
    results.push(first.outcome.kind === "failed" ? await shootOnce(target) : first);
  }
  await context.close();
  return results;
};

const inBatches = async <T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return results;
};

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace(/-\d{3}Z$/, "Z");
const outDir = join(args.out ?? process.env.UI_HARNESS_OUT ?? DEFAULT_OUT, stamp);
await mkdir(outDir, { recursive: true });

const harness = await startHarnessServer({ upstream: resolveUpstream(process.env) });
// The full Chromium build, not the headless shell: only it honours granted permissions, e.g. notifications.
const browser = await chromium.launch({ channel: "chromium" });
try {
  const all =
    args.path === undefined
      ? await discoverPages(harness.url, harness.apps, harness.shellPages)
      : [adHocPage(args.path)];
  const selected = selectPages(all, args.pages);
  const ready = selected.filter((page): page is Extract<PageTarget, { kind: "ready" }> => page.kind === "ready");
  const unresolved = selected.filter((page) => page.kind === "unresolved");

  const shots = (
    await inBatches(variants, PARALLEL_CONTEXTS, (variant) => shoot(browser, harness.url, outDir, variant, ready))
  ).flat();
  const ordered = ready.flatMap(({ name }) => shots.filter((shot) => shot.page === name));

  await Bun.write(
    join(outDir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        upstream: harness.upstream.href,
        unresolved,
        refusedWrites: harness.refused(),
        shots: ordered,
      },
      null,
      2,
    ),
  );
  await Bun.write(join(outDir, "index.html"), renderContactSheet(`UI shots ${stamp}`, ordered));

  console.log(`\n${ordered.length} shots → ${outDir}`);
  console.log(`contact sheet: ${join(outDir, "index.html")}\n`);
  for (const { name, path } of ready) {
    const row = ordered.filter((shot) => shot.page === name);
    const captured = row.filter((shot) => shot.outcome.kind === "captured").length;
    const notCaptured = [
      ...new Set(
        row.flatMap((shot) =>
          shot.outcome.kind === "http-error"
            ? [`HTTP ${shot.outcome.status}`]
            : shot.outcome.kind === "failed"
              ? [shot.outcome.message]
              : [],
        ),
      ),
    ];
    const errors = row.reduce((sum, shot) => sum + shot.consoleErrors.length + shot.failedRequests.length, 0);
    const themeMismatch = row.some(
      (shot) => shot.outcome.kind === "captured" && shot.outcome.appliedTheme !== shot.variant.theme,
    );
    const notes = [
      errors > 0 ? `${errors} console/request errors` : null,
      themeMismatch ? "data-theme did not match the stored theme" : null,
      ...notCaptured,
    ].filter((note) => note !== null);
    console.log(
      `${name.padEnd(22)} ${path.padEnd(52)} ${captured}/${row.length}  ${notes.length === 0 ? "ok" : notes.join("; ")}`,
    );
  }
  for (const page of unresolved) {
    console.log(`${page.name.padEnd(22)} ${page.pattern.padEnd(52)} skipped  ${page.reason}`);
  }
  const refused = harness.refused();
  if (refused.length > 0) {
    console.log(
      `\nwrites answered locally (never sent upstream): ${refused.map(({ method, path }) => `${method} ${path}`).join(", ")}`,
    );
  }
} finally {
  await browser.close();
  await harness.stop();
}
