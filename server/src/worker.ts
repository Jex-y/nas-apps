import { collectAppWork, createJobQueue, createSql, parseWorkerConfig, runWorker } from "@nas/core";
import { createApps } from "./apps";

/** The worker is unhealthy once its loops have been silent for this long; well above the idle poll and tick. */
const STALE_AFTER_MS = 60_000;

const config = parseWorkerConfig(process.env);
const sql = createSql(config.database);
const apps = createApps({
  env: process.env,
  publicUrl: config.publicUrl,
  sql,
  blob: config.blob,
  notify: config.notify,
  jobs: createJobQueue(sql),
  identity: { kind: "tailscale" },
});
const work = collectAppWork(apps);

let lastActivity = Date.now();
const health = Bun.serve({
  port: config.healthPort,
  hostname: "127.0.0.1",
  routes: {
    "/healthz": () =>
      Date.now() - lastActivity < STALE_AFTER_MS ? new Response("ok") : new Response("stalled", { status: 503 }),
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

const stop = new AbortController();
process.on("SIGTERM", () => stop.abort());
process.on("SIGINT", () => stop.abort());

console.log(
  `Worker running ${work.jobs.length} jobs and ${work.schedules.length} schedules with concurrency ${config.concurrency}`,
);
await runWorker({
  sql,
  jobs: work.jobs,
  schedules: work.schedules,
  concurrency: config.concurrency,
  signal: stop.signal,
  onActivity: () => {
    lastActivity = Date.now();
  },
});

await health.stop();
await sql.close();
