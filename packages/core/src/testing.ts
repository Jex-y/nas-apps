import { afterAll } from "bun:test";
import type { AppContext, AppModule } from "./app-module";
import { parseRuntimeConfig } from "./config";
import { createSql } from "./database";
import { createJobQueue } from "./jobs/queue";
import { createNotifierFactory } from "./notify";
import { startServer } from "./server";

/** A context built from the test environment, closed after the test file. Identity is Tailscale headers. */
export const createTestContext = (): AppContext => {
  const config = parseRuntimeConfig(process.env);
  const sql = createSql(config.database);
  afterAll(() => sql.close());
  return {
    env: process.env,
    publicUrl: config.publicUrl,
    sql,
    blob: config.blob,
    notifier: createNotifierFactory(config.notify, sql),
    jobs: createJobQueue(sql),
    identity: { kind: "tailscale" },
  };
};

export type TestRequestInit = RequestInit & {
  /** Sent as the Tailscale login; omit to make an anonymous request. */
  readonly as?: string;
};

export type TestRequest = (path: string, init?: TestRequestInit) => Promise<Response>;

/** Boots a real server for the given apps on a random port, torn down after the test file. */
export const startTestServer = (
  createApps: (context: AppContext) => readonly AppModule[],
  context: AppContext = createTestContext(),
): TestRequest => {
  const server = startServer({
    port: 0,
    development: false,
    apps: createApps(context),
    shell: { identity: context.identity, sql: context.sql, webPush: null },
  });
  afterAll(() => server.stop(true));

  return (path, { as, ...init } = {}) => {
    const headers = new Headers(init.headers);
    if (as !== undefined) {
      headers.set("Tailscale-User-Login", as);
    }
    return fetch(new URL(path, server.url), { ...init, headers, redirect: "manual" });
  };
};

export const uniqueLogin = (): string => `${crypto.randomUUID()}@test.local`;
