import { afterAll } from "bun:test";
import type { AppContext, AppModule } from "./app-module";
import { parseDatabaseConfig } from "./config";
import { createSql } from "./database";
import { startServer } from "./server";

export type TestRequestInit = RequestInit & {
  /** Sent as the Tailscale login; omit to make an anonymous request. */
  readonly as?: string;
};

/** Boots a real server for the given apps on a random port, torn down after the test file. */
export const startTestServer = (createApps: (context: AppContext) => readonly AppModule[]) => {
  const sql = createSql(parseDatabaseConfig(process.env));
  const server = startServer({
    port: 0,
    development: false,
    apps: createApps({ sql, identity: { kind: "tailscale" } }),
  });
  afterAll(async () => {
    await server.stop(true);
    await sql.close();
  });

  return (path: string, { as, ...init }: TestRequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (as !== undefined) {
      headers.set("Tailscale-User-Login", as);
    }
    return fetch(new URL(path, server.url), { ...init, headers, redirect: "manual" });
  };
};

export const uniqueLogin = (): string => `${crypto.randomUUID()}@test.local`;
