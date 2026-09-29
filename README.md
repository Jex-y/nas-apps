# nas-apps

Personal apps served from the NAS to the tailnet at `https://apps.tail12605.ts.net/<app>/`.

One Bun server hosts every app. Each app is its own workspace package owning its routes, its Postgres schema,
its migrations, its prefix in object storage and its React UI, so any one of them can move to its own server later.

```
packages/core     shared runtime: config, identity, server, migrations, blob storage, test harness, web fetch helpers
apps/<slug>       one app: src/api (routes + drizzle schema), src/web (React), src/contract.ts (zod), drizzle/
server            composition root: the app list, the entrypoint, the migrate entrypoint
scripts/build.ts  bundles server + UIs into a self-contained dist/
deploy/           the script the NAS runs for each deploy
```

## Develop

```sh
bun install
bun run db:up        # Postgres on localhost:5499 (dev db `apps`, test db `apps_test`), Garage S3 on localhost:3900
bun run db:migrate
bun run dev          # http://localhost:3000, hot reload for server and UI
```

In development the server trusts `DEV_USER` from `.env.development` instead of Tailscale headers.

```sh
bun run lint         # biome; `bun run format` to fix
bun run typecheck
bun test             # against the real test database (migrated by the preload) and Garage
```

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

## Install and notify

All the apps are one installable web app scoped to `/`: open `https://apps.tail12605.ts.net/` in Safari, Share →
Add to Home Screen, then open it from the Home Screen and turn notifications on. iOS only offers Web Push to an
installed app. An app sends with `context.notifier("<slug>").send(...)`, which reaches every subscribed device, or
`context.notifier("<slug>", login)` to reach only that person's.

## Store files

`createBlobStore(context.blob, "<slug>")` gives an app its own prefix in the shared `apps` bucket. Upload through
the server with `write`, and hand browsers `downloadUrl` (a short-lived presigned URL) rather than streaming files
through the server. `apps/flats` listing and viewing photos are the worked example.

Blob keys and database rows are not transactional. Write the blob before inserting its row and delete the row
before its blob, so a failure leaves at worst an unreferenced blob, never a row pointing at nothing.

## Add an app

1. Copy `apps/status` to `apps/<slug>` and rename `status` throughout: package name, route prefixes, module.
2. For a database, add `src/api/schema.ts` (its own `pgSchema`), `drizzle.config.ts` and `migrations.ts` modelled
   on `apps/flats`, then run `bun run --cwd apps/<slug> db:generate --name init`.
3. Add `"@nas/<slug>": "workspace:*"` to `server/package.json`, register the app and its migrations in
   `server/src/apps.ts`, then `bun install`.

The server refuses to start if two apps share a slug or an app declares a route outside `/<slug>/`.

## Pet

`apps/pet` is a Tamagotchi-style pixel pet kept alive by walking. Each tailnet login hatches one; meeting the daily
step goal (8,000 unless changed in Settings) feeds it, streaks raise its mood and bond and unlock accessories, and
missed days make it hungry, then sad, then sick. After a week of them it runs away, and comes home on a day of one and
a half times the goal. Its state is derived from the day-by-day step history each time it is read, never stored, so
late or corrected Health data rewrites the story. It nudges its owner at 18:00 London time when short of the goal,
when the goal is hit, and when steps stop arriving.

Apple Health has no web API, so an iOS Shortcut sends the totals. The Pet app's Health page has the full recipe;
in short:

1. Build a shortcut that uses Find Health Samples (Steps, Group By Day) and Calculate Statistics (Sum) to total
   today's and yesterday's steps, and posts them with Get Contents of URL to
   `https://apps.tail12605.ts.net/pet/api/health` as JSON:
   `{"days":[{"date":"2026-09-27","steps":9412},{"date":"2026-09-28","steps":3180}]}`. Each day may also carry
   `distanceMeters` and `activeEnergyKcal`; resending a day replaces it.
2. Run it once by hand with Tailscale on, allowing Health access and choosing Always Allow for the server, so later
   runs need no confirmation.
3. Add personal automations that Run Immediately: when a few everyday apps are opened, and at 17:45.

The Shortcut cannot read Health while the iPhone is locked, so a run then fails and the next one with the phone
unlocked catches up. The pet only warns about missing data after 36 hours without any.

## Tasks

`apps/tasks` is a to-do list whose tasks form a dependency graph, shared by everyone on the tailnet and grouped into
projects. Each project has three views of the same tasks:

- **List**: the graph as stages, each task waiting only on tasks in earlier stages, with a checkbox to finish it.
- **Board**: To do, Doing and Done columns. Cards drag between and within columns; on touch each card has a menu.
- **Timeline**: a Gantt chart of the critical-path schedule, from each task's duration, its "not before" date and
  what it waits on, with arrows for dependencies, the critical path in red, due dates and today marked.

The API refuses any dependency that would close a cycle or reach into another project, and only lets a task leave
To do once everything it waits on is done (and a done task reopen only while nothing that waits on it has started).
The graph and schedule logic in `src/plan.ts` is pure and shared by the server and the UI.

From 08:00 London time each project with anything overdue, due today or tomorrow, or scheduled to miss its due date
sends one push notification a day to every subscribed device.

### Manage tasks from Claude

The app serves an MCP server at `https://apps.tail12605.ts.net/tasks/mcp` (Streamable HTTP, stateless), with tools
to list and read projects (each with its critical-path schedule) and to create, edit, move, link and delete tasks.
It trusts the same Tailscale identity as the web app, so it works from any client on a tailnet device, e.g.
Claude Code:

```sh
claude mcp add --transport http --scope user tasks https://apps.tail12605.ts.net/tasks/mcp
```

Clients that connect from the cloud rather than your device, such as claude.ai's custom connectors, cannot reach
the tailnet.

## Deploy

Every push to `main` runs lint, typecheck, the migration check and the tests. It then builds
`ghcr.io/jex-y/nas-apps:<sha>`, joins the tailnet as an ephemeral `tag:ci` node, and SSHes to the NAS with a key
that can only run `deploy/nas-deploy.sh`, passing just the commit SHA. The script pulls that image, unpacks the
stack (`deploy/stack/`, baked into the image) into `/volume1/Ed/app/releases/<sha>/`, migrates, starts the server
and waits for its health check, rolling back to the previous release if it fails.

The stack joins the tailnet as its own device, `apps.tail12605.ts.net`, through a Tailscale sidecar. Server,
Postgres and Garage share the sidecar's network and publish nothing on the NAS itself:

- `https://apps.tail12605.ts.net/` is the server
- `https://apps.tail12605.ts.net:3900` is S3 (Garage, region `garage`, path-style, bucket `apps`)
- `psql -h apps.tail12605.ts.net -U <user> apps` is Postgres

Postgres and Garage keep their data in `/volume1/Ed/app/data`, inside the `Ed` share, so Hyper Backup covers it.

### One-time setup

**Tailscale**, in the policy file:

```jsonc
"tagOwners": {
    "tag:ci":   ["autogroup:admin"], // ephemeral GitHub Actions runners
    "tag:apps": ["autogroup:admin"], // the stack's sidecar
},
"acls": [
    {"action": "accept", "src": ["autogroup:member"], "dst": ["*:*"]},
    {"action": "accept", "src": ["tag:ci"], "dst": ["nas:22"]},
],
```

- An OAuth client with the Auth Keys write scope for `tag:ci`, for CI.
- A one-off auth key for the sidecar: not reusable, not ephemeral, pre-approved, tagged `tag:apps`. It is only
  used on first start; the sidecar keeps its identity in the `tailscale-state` volume after that.

**NAS**

- `/volume1/Ed/app/.env` holds `POSTGRES_USER`, `POSTGRES_PASSWORD`, `TS_AUTHKEY`, and Garage's
  `GARAGE_RPC_SECRET` (`openssl rand -hex 32`), `GARAGE_DEFAULT_ACCESS_KEY` (`GK` + `openssl rand -hex 12`) and
  `GARAGE_DEFAULT_SECRET_KEY` (`openssl rand -hex 32`). Garage creates that key and the `apps` bucket on first
  start.
- The same file holds the Web Push keys: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` from
  `bunx web-push generate-vapid-keys`, and `VAPID_SUBJECT` (`mailto:` your address). Changing the pair invalidates
  every subscription, so generate it once.
- Optionally, `TFL_API_KEY` in the same file: the primary key of a subscription on the
  [TfL API portal](https://api-portal.tfl.gov.uk/). Flats uses it to time commutes from each property to the places
  saved on its Commutes page; without it they are left blank. It is read on start, so it takes effect from the next
  deploy, and a daily sweep then times the properties already found.
- Log in to GHCR so the NAS can pull the private image, using a classic PAT with only `read:packages`:
  `docker login ghcr.io -u Jex-y`
- Install the deploy script and give CI a key that can run nothing else:

  ```sh
  ssh nas 'mkdir -p ~/bin && cat > ~/bin/nas-apps-deploy && chmod 755 ~/bin/nas-apps-deploy' < deploy/nas-deploy.sh
  ```

  and in the NAS's `~/.ssh/authorized_keys`:

  ```
  command="/var/services/homes/ed/bin/nas-apps-deploy",restrict ssh-ed25519 AAAA… nas-apps-ci
  ```

**GitHub**, in a `production` environment on the repo:

- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`: the OAuth client.
- `NAS_DEPLOY_KEY`: the private half of the CI key.
