import { afterAll, beforeAll, expect, test } from "bun:test";
import { type HarnessServer, startHarnessServer } from "./server";

const seen: string[] = [];
const upstream = Bun.serve({
  port: 0,
  fetch: (request) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({ ok: true });
  },
});
let harness: HarnessServer;

beforeAll(async () => {
  harness = await startHarnessServer({ upstream: new URL(upstream.url.href) });
});
afterAll(async () => {
  await harness.stop();
  await upstream.stop(true);
});

const call = (method: string, path: string) =>
  fetch(new URL(path, harness.url), { method, body: method === "GET" || method === "HEAD" ? null : "{}" });

test("forwards GET and HEAD for data paths", async () => {
  seen.length = 0;
  expect((await call("GET", "/flats/api/properties?x=1")).status).toBe(200);
  expect((await call("HEAD", "/shell/api/apps")).status).toBe(200);
  expect((await call("GET", "/flats/shell/icons/icon-192.png")).status).toBe(200);
  expect((await call("GET", "/flats/shell/manifest.webmanifest")).status).toBe(200);
  expect(seen).toEqual([
    "GET /flats/api/properties",
    "HEAD /shell/api/apps",
    "GET /flats/shell/icons/icon-192.png",
    "GET /flats/shell/manifest.webmanifest",
  ]);
});

test("answers every write locally and never forwards it", async () => {
  seen.length = 0;
  const writes = ["POST", "PUT", "PATCH", "DELETE"].flatMap((method) =>
    ["/flats/api/properties/1/status", "/tasks/api/tasks", "/flats/shell/api/push/test", "/tasks/mcp", "/anything"].map(
      (path) => [method, path] as const,
    ),
  );
  for (const [method, path] of writes) {
    expect((await call(method, path)).status).toBe(405);
  }
  expect((await call("POST", "/flats/shell/api/push/subscriptions")).status).toBe(204);
  expect(seen).toEqual([]);
  expect(harness.refused()).toHaveLength(writes.length + 1);
});

test("never serves production pages for paths the worktree lacks", async () => {
  seen.length = 0;
  expect((await call("GET", "/shell/nonexistent")).status).toBe(404);
  expect((await call("GET", "/flats/shell/nonexistent")).status).toBe(404);
  expect((await call("GET", "/chunk-abc.css")).status).toBe(404);
  expect(seen).toEqual([]);
});

test("serves the shell's settings page for the launcher and inside each app", async () => {
  for (const path of ["/shell/settings", "/flats/shell/settings"]) {
    const response = await call("GET", path);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Settings</title>");
  }
});
