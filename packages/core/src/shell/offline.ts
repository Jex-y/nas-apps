/** What the service worker keeps on the device so an app opens without the network. */
export type OfflineManifest = {
  /** Changes whenever any of the files does, so the worker knows to fetch them again. */
  readonly version: string;
  /** The app's page first, then every file it loads. */
  readonly urls: readonly string[];
};

/** `null` when the page was not bundled ahead of time, as under `bun run dev`, where its files are not yet known. */
export const offlineManifest = (slug: string, page: Bun.HTMLBundle): OfflineManifest | null => {
  if (page.files === undefined) {
    return null;
  }
  const assets = page.files.filter((file) => file.loader !== "html");
  return {
    version: Bun.hash(page.files.map((file) => `${file.path}:${file.headers.etag}`).join("\n")).toString(36),
    urls: [`/${slug}/`, ...assets.map((file) => new URL(file.path, "http://bundle/").pathname)],
  };
};
