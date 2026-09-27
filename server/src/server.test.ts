import { describe, expect, test } from "bun:test";
import { startTestServer } from "@nas/core/testing";
import { createApps } from "./apps";

const request = startTestServer(createApps);

describe("server", () => {
  test("health check responds", async () => {
    const response = await request("/healthz");
    expect(response.status).toBe(200);
  });

  test("landing page links every app", async () => {
    const html = await (await request("/")).text();
    expect(html).toContain('href="/notes/"');
  });

  test("app root redirects to its trailing-slash path", async () => {
    const response = await request("/notes");
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("/notes/");
  });

  test("app page serves the bundled HTML", async () => {
    const response = await request("/notes/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });

  test("unknown paths are JSON 404s", async () => {
    const response = await request("/nope");
    expect(response.status).toBe(404);
  });
});
