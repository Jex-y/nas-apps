import { cp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Produces a self-contained `dist/`. The bundle resolves its HTML assets and the migrations resolve their
 * folders relative to the working directory, so `dist/` must be the cwd when running anything inside it.
 */
const outdir = "dist";

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["server/src/index.ts", "server/src/migrate.ts"],
  outdir,
  target: "bun",
  minify: true,
  sourcemap: "linked",
  publicPath: "/",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

for await (const journal of new Bun.Glob("apps/*/drizzle/meta/_journal.json").scan()) {
  const folder = dirname(dirname(journal));
  await cp(folder, join(outdir, folder), { recursive: true });
}

for (const output of result.outputs) {
  console.log(`${output.path.replace(`${process.cwd()}/`, "")}  ${(output.size / 1024).toFixed(1)} KB`);
}
