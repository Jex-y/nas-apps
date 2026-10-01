import { describe, expect, test } from "bun:test";
import { offlineManifest } from "./offline";

const file = (path: string, loader: "js" | "css" | "html" | "file", etag: string) => ({
  path,
  loader,
  isEntry: loader !== "file",
  headers: { etag, "content-type": "text/plain" },
});

const bundle = (etag = "a1"): Bun.HTMLBundle => ({
  index: "./index.html",
  files: [
    file("./chunk-1.js", "js", etag),
    file("./index.html", "html", "b2"),
    file("./chunk-2.css", "css", "c3"),
    file("./worker-3.js", "file", "d4"),
  ],
});

describe("offlineManifest", () => {
  test("lists the app's page and every file it loads", () => {
    expect(offlineManifest("lifts", bundle())?.urls).toEqual([
      "/lifts/",
      "/chunk-1.js",
      "/chunk-2.css",
      "/worker-3.js",
    ]);
  });

  test("changes version when a file does", () => {
    expect(offlineManifest("lifts", bundle())?.version).toBe(offlineManifest("lifts", bundle())?.version as string);
    expect(offlineManifest("lifts", bundle("a2"))?.version).not.toBe(offlineManifest("lifts", bundle())?.version);
  });

  test("has nothing to list for a page not bundled ahead of time", () => {
    expect(offlineManifest("lifts", { index: "./index.html" })).toBeNull();
  });
});
