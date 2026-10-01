import type { BunPlugin } from "bun";

/** How `@tanstack/browser-db-sqlite-persistence` names its worker script: a path beside the module, never bundled. */
const WORKER_URL = /"" \+ new URL\("(\.\.\/assets\/[^"]+)", import\.meta\.url\)\.href/;

/**
 * Bundles the SQLite worker as an asset of whichever page opens a database on the device, so the page loads it from
 * the URL the bundler gave it. Left alone, the module asks for a path that exists only inside `node_modules`.
 */
const bundleSqliteWorker: BunPlugin = {
  name: "bundle-sqlite-worker",
  setup(build) {
    build.onLoad({ filter: /browser-db-sqlite-persistence\/dist\/esm\/opfs-worker\.js$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const [reference, asset] = source.match(WORKER_URL) ?? [];
      if (reference === undefined || asset === undefined) {
        throw new Error(`${path} no longer loads its worker the way this plugin rewrites`);
      }
      return {
        loader: "js",
        contents: `import workerUrl from ${JSON.stringify(asset)} with { type: "file" };\n${source.replace(reference, "workerUrl")}`,
      };
    });
  },
};

export default bundleSqliteWorker;
