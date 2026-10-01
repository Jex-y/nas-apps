import { describe, expect, test } from "bun:test";
import { drainJobs, type RegisteredJob } from "@apps/core";
import { callTool, connectMcp, startTestServer, uniqueLogin } from "@apps/core/testing";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { BANK, createStreetsTestContext, fakeOverpass, fakeStrava, gpxRun, NOON } from "../../test/support";
import type { Activity, NearbyStreet, NetworkStatus, Stats, StravaStatus, UploadResult } from "../contract";
import { createStreetsApp } from "../module";

const { context } = createStreetsTestContext();

let jobs: readonly RegisteredJob[] = [];
const request = startTestServer((ctx) => {
  const app = createStreetsApp(ctx, { strava: fakeStrava(() => NOON), overpass: fakeOverpass(), now: () => NOON });
  jobs = app.jobs;
  return [app];
}, context);
const drain = () => drainJobs(context.sql, jobs);

const connect = (as: string) => connectMcp(request, "/streets/mcp", as);

const call = async <T>(client: Client, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse((await callTool(client, name, args)).text) as T;

const here = { lat: BANK[0], lon: BANK[1] };

describe("streets mcp", () => {
  test("requires a Tailscale identity", async () => {
    const response = await request("/streets/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  test("offers tools for the person's runs, progress and Strava connection", async () => {
    const client = await connect(uniqueLogin());
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "disconnect_strava",
      "get_street_progress",
      "get_streets_status",
      "import_gpx",
      "list_runs",
      "list_streets_near",
      "refresh_street_network",
      "reimport_strava_history",
      "rematch_runs",
      "set_counted_activities",
      "suggest_streets",
    ]);
    expect(client.getInstructions()).toContain("CityStrides");
  });

  test("imports a run and reads back the progress it made, for the connected person only", async () => {
    const me = uniqueLogin();
    const client = await connect(me);

    expect(await call<UploadResult>(client, "import_gpx", { filename: "morning.gpx", gpx: gpxRun })).toEqual({
      imported: 1,
      duplicates: 0,
      failed: [],
    });
    expect(await call<UploadResult>(client, "import_gpx", { filename: "notes.gpx", gpx: "<gpx/>" })).toMatchObject({
      failed: [{ filename: "notes.gpx", error: "No track points" }],
    });
    await drain();

    const runs = await call<Activity[]>(client, "list_runs");
    const progress = await call<Stats>(client, "get_street_progress");
    const near = await call<NearbyStreet[]>(client, "list_streets_near", { ...here, radiusMetres: 300 });

    expect(runs).toMatchObject([{ name: "Bank & Monument loop", source: "gpx", status: "matched" }]);
    expect(progress.overall.nodesHit).toBeGreaterThan(0);
    expect(near.length).toBeGreaterThan(5);
    expect(near.map((street) => street.distanceMetres)).toEqual(
      near.map((street) => street.distanceMetres).toSorted((a, b) => a - b),
    );
    expect(near.some((street) => street.state !== "untouched")).toBe(true);
    expect(near.every((street) => street.borough === "City of London")).toBe(true);

    const stranger = await connect(uniqueLogin());
    expect(await call<Activity[]>(stranger, "list_runs")).toEqual([]);
    expect((await call<Stats>(stranger, "get_street_progress")).overall.nodesHit).toBe(0);
  });

  test("reports the Strava connection and the street network together", async () => {
    const client = await connect(uniqueLogin());

    const status = await call<{ strava: StravaStatus; network: NetworkStatus }>(client, "get_streets_status");

    expect(status.strava).toMatchObject({ configured: true, connection: null });
    expect(status.network).toMatchObject({ boroughs: 1, streets: 28 });
  });

  test("suggests where to run, in London", async () => {
    const client = await connect(uniqueLogin());

    const suggestions = await call<{ streets: { name: string }[] }[]>(client, "suggest_streets", here);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(await callTool(client, "suggest_streets", { lat: 48.85, lon: 2.35 })).toEqual({
      isError: true,
      text: "That is outside London, where no streets are tracked",
    });
  });

  test("hands refusals back as tool errors", async () => {
    const client = await connect(uniqueLogin());

    for (const [name, args] of [
      ["set_counted_activities", { includeWalks: true }],
      ["reimport_strava_history", {}],
      ["disconnect_strava", {}],
    ] as const) {
      expect(await callTool(client, name, args)).toEqual({ isError: true, text: "Strava is not connected" });
    }
  });
});
