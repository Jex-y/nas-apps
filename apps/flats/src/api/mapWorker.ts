/**
 * MapLibre's web worker bundled into one script. Import it as a macro so the script is inlined into the server:
 * `dist/` ships without `node_modules`. A macro may not call `Bun.build`, hence the CLI.
 */
export const bundleMapWorker = (): string => {
  const built = Bun.spawnSync([
    process.execPath,
    "build",
    Bun.resolveSync("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.dir),
    "--target=browser",
    "--minify",
  ]);
  if (!built.success) {
    throw new Error(`Could not bundle the MapLibre worker: ${built.stderr.toString()}`);
  }
  return built.stdout.toString();
};
