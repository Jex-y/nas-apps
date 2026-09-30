# Building an app

`packages/core` is the shared runtime every app builds on: config, identity, the server, jobs, migrations, blob
storage, push and the test harness.

## Add an app

1. Copy `apps/status` to `apps/<slug>` and rename `status` throughout: package name, route prefixes, module.
2. For a database, add `src/api/schema.ts` (its own `pgSchema`), `drizzle.config.ts` and `migrations.ts` modelled
   on `apps/flats`, then run `bun run --cwd apps/<slug> db:generate --name init`.
3. Add `"@apps/<slug>": "workspace:*"` to `server/package.json`, register the app and its migrations in
   `server/src/apps.ts`, then `bun install`.

The server refuses to start if two apps share a slug or an app declares a route outside `/<slug>/`.

## Serve tools over MCP

Anything a person can do in an app's UI should also be a tool. An app's `mcp` gives its instructions for the model and
registers its tools for the connected viewer; the server serves them at `/<slug>/mcp` and with every other app's at
`/mcp`, so tool names must be unique across apps. Keep the logic in a service the HTTP routes and the tools both call
(`apps/tasks/src/api/service.ts`), and wrap each tool in `toolResult` so an `HttpError` reaches the model as a tool
error it can act on. Answer a list tool briefly and leave the full record to a `get_` tool: Claude Code truncates tool
results over 25,000 tokens.

## Change the schema

Edit `apps/<slug>/src/api/schema.ts`, then:

```sh
bun run --cwd apps/<slug> db:generate --name <what_changed>
bun run db:migrate
```

Commit the generated SQL. CI fails if the schema and the committed migrations disagree.

Migrations run before the new server starts, and a failed deploy rolls the server back but not the database.
Keep every migration compatible with the previous release: add columns nullable or with a default, and drop
things only once no deployed code reads them.

## Notify

An app sends with `context.notifier("<slug>").send(...)`, which reaches every subscribed device, or
`context.notifier("<slug>", login)` to reach only that person's.

To receive them on iOS, open `https://apps.<tailnet>.ts.net/` in Safari, Share → Add to Home Screen, then open it
from the Home Screen and turn notifications on. Test or turn them off under Settings (`/shell/settings`). iOS only
offers Web Push to an installed app.

## Store files

`createBlobStore(context.blob, "<slug>")` gives an app its own prefix in the shared `apps` bucket. Upload through
the server with `write`, and hand browsers `downloadUrl` (a short-lived presigned URL) rather than streaming files
through the server. `apps/flats` listing and viewing photos are the worked example.

Blob keys and database rows are not transactional. Write the blob before inserting its row and delete the row
before its blob, so a failure leaves at worst an unreferenced blob, never a row pointing at nothing.
