import { dirname } from "node:path";

/**
 * Fails unless drizzle-kit explicitly reports "No schema changes" for every package with a drizzle config.
 * drizzle-kit exits 0 even when it cannot load the schema, so its exit code alone proves nothing.
 */
const configs = await Array.fromAsync(new Bun.Glob("{apps,packages}/*/drizzle.config.ts").scan());
if (configs.length === 0) {
  throw new Error("No drizzle.config.ts found; is this running from the repo root?");
}

let failed = false;
for (const config of configs.sort()) {
  const cwd = dirname(config);
  const run = Bun.spawnSync(["bunx", "drizzle-kit", "generate"], { cwd, stdout: "pipe", stderr: "pipe" });
  const output = `${run.stdout.toString()}${run.stderr.toString()}`;
  if (output.includes("No schema changes")) {
    console.log(`✓ ${cwd}: migrations match the schema`);
  } else {
    failed = true;
    console.error(`✗ ${cwd}: migrations do not match the schema, or drizzle-kit failed:\n${output}`);
  }
}

if (failed) {
  process.exit(1);
}
