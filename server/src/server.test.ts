import { describe, expect, test } from "bun:test";
import { callTool, connectMcp, startTestServer, uniqueLogin } from "@apps/core/testing";
import { createApps } from "./apps";

const request = startTestServer(createApps);

describe("server", () => {
  test("health check responds", async () => {
    const response = await request("/healthz");
    expect(response.status).toBe(200);
  });

  test("launcher lists every app", async () => {
    expect(await (await request("/")).text()).toContain(`<ul id="apps"`);
    expect(await (await request("/shell/api/apps")).json()).toContainEqual({ slug: "flats", title: "Flat hunt" });
  });

  test("app root redirects to its trailing-slash path", async () => {
    const response = await request("/flats");
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("/flats/");
  });

  test("app page serves the bundled HTML", async () => {
    const response = await request("/flats/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });

  test("one MCP server offers every app's tools, each app's alone at its own path", async () => {
    const all = await connectMcp(request, "/mcp", uniqueLogin());
    const names = (await all.listTools()).tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining(["list_properties", "list_tasks", "get_status"]));
    expect(all.getInstructions()).toContain("## Flat hunt");
    expect(JSON.parse((await callTool(all, "get_status")).text).apps).toContainEqual(
      expect.objectContaining({ slug: "tasks" }),
    );

    const status = await connectMcp(request, "/status/mcp", uniqueLogin());
    expect((await status.listTools()).tools.map((tool) => tool.name)).toEqual(["get_status"]);
  });

  test("MCP requires a Tailscale identity", async () => {
    const response = await request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  test("unknown paths are JSON 404s", async () => {
    const response = await request("/nope");
    expect(response.status).toBe(404);
  });
});
