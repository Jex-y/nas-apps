import { describe, expect, test } from "bun:test";
import { startTestServer } from "@nas/core/testing";
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

  test("unknown paths are JSON 404s", async () => {
    const response = await request("/nope");
    expect(response.status).toBe(404);
  });
});
