import { afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
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
    shell: { identity: context.identity, sql: context.sql, webPush: parseRuntimeConfig(process.env).notify },
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

/** The MCP SDK's own client, reaching `path` on the test server as `as` from a tailnet device. */
export const connectMcp = async (request: TestRequest, path: string, as: string): Promise<Client> => {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(path, "http://apps.test"), {
    fetch: (url, init) => request(new URL(url).pathname, { ...init, as }),
  });
  // The SDK's optional `sessionId` is typed without `| undefined`, which `exactOptionalPropertyTypes` rejects.
  await client.connect(transport as Transport);
  return client;
};

export type ToolText = { readonly isError: boolean; readonly text: string };

/** Calls a tool that answers in text, as most do. */
export const callTool = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolText> => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content?.text ?? "" };
};
