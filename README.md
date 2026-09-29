# tailnet-apps

Small personal web apps, self-hosted on any Docker host and served privately to your
[Tailscale](https://tailscale.com) tailnet at `https://apps.<tailnet>.ts.net/<app>/`. Tailscale does the auth: every
request carries the viewer's tailnet login, so there are no accounts or passwords to manage.

| App      | What it does                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `flats`  | Watches Rightmove saved searches, triages new listings by swiping, and times commutes with the TfL API |
| `pet`    | A Tamagotchi-style pixel pet kept alive by walking, fed by Apple Health step counts                    |
| `tasks`  | A personal to-do list with dependencies, a board, a critical-path timeline and an MCP server          |
| `status` | Health of the stack: services, job queue, schedules and recent failures                               |

One Bun server hosts every app. Each app is its own workspace package owning its routes, its Postgres schema,
its migrations, its prefix in object storage and its React UI, so any one of them can move to its own server later.
All of them install together as one PWA with Web Push notifications.

```
packages/core     shared runtime: config, identity, server, jobs, migrations, blob storage, push, test harness
apps/<slug>       one app: src/api (routes + drizzle schema), src/web (React), src/contract.ts (zod), drizzle/
server            composition root: the app list, the server, worker and migrate entrypoints
scripts/build.ts  bundles server + UIs into a self-contained dist/
deploy/           the production stack, the host's deploy script and its .env template
```

## Develop

Needs [Bun](https://bun.sh) and Docker.

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

### Change the schema

Edit `apps/<slug>/src/api/schema.ts`, then:

```sh
bun run --cwd apps/<slug> db:generate --name <what_changed>
bun run db:migrate
```

Commit the generated SQL. CI fails if the schema and the committed migrations disagree.

Migrations run before the new server starts, and a failed deploy rolls the server back but not the database.
Keep every migration compatible with the previous release: add columns nullable or with a default, and drop
things only once no deployed code reads them.

### Add an app

1. Copy `apps/status` to `apps/<slug>` and rename `status` throughout: package name, route prefixes, module.
2. For a database, add `src/api/schema.ts` (its own `pgSchema`), `drizzle.config.ts` and `migrations.ts` modelled
   on `apps/flats`, then run `bun run --cwd apps/<slug> db:generate --name init`.
3. Add `"@apps/<slug>": "workspace:*"` to `server/package.json`, register the app and its migrations in
   `server/src/apps.ts`, then `bun install`.

The server refuses to start if two apps share a slug or an app declares a route outside `/<slug>/`.

### Notify

An app sends with `context.notifier("<slug>").send(...)`, which reaches every subscribed device, or
`context.notifier("<slug>", login)` to reach only that person's.

To receive them on iOS, open `https://apps.<tailnet>.ts.net/` in Safari, Share → Add to Home Screen, then open it
from the Home Screen and turn notifications on. iOS only offers Web Push to an installed app.

### Store files

`createBlobStore(context.blob, "<slug>")` gives an app its own prefix in the shared `apps` bucket. Upload through
the server with `write`, and hand browsers `downloadUrl` (a short-lived presigned URL) rather than streaming files
through the server. `apps/flats` listing and viewing photos are the worked example.

Blob keys and database rows are not transactional. Write the blob before inserting its row and delete the row
before its blob, so a failure leaves at worst an unreferenced blob, never a row pointing at nothing.

## Apps

### Flats

Paste a Rightmove saved-search URL on the Searches page and Flats polls it (07:00–23:00 London time), notifying
about new listings and dropping shared ownership, flats under 650 sq ft and service charges over £6,000.

To time commutes, set `TFL_API_KEY` to the primary key of a subscription on the
[TfL API portal](https://api-portal.tfl.gov.uk/) and add places on the Commutes page. Without it commutes are left
blank. It is read on start, so it takes effect from the next deploy, and a daily sweep then times the properties
already found.

### Pet

Each tailnet login hatches one pet. Meeting the daily step goal (8,000 unless changed in Settings) feeds it, streaks
raise its mood and bond and unlock accessories, and missed days make it hungry, then sad, then sick. After a week of
them it runs away, and comes home on a day of one and a half times the goal. Its state is derived from the day-by-day
step history each time it is read, never stored, so late or corrected Health data rewrites the story. It nudges its
owner at 18:00 London time when short of the goal, when the goal is hit, and when steps stop arriving.

Apple Health has no web API, so an iOS Shortcut sends the totals. The Pet app's Health page has the full recipe;
in short:

1. Build a shortcut that uses Find Health Samples (Steps, Group By Day) and Calculate Statistics (Sum) to total
   today's and yesterday's steps, and posts them with Get Contents of URL to
   `https://apps.<tailnet>.ts.net/pet/api/health` as JSON:
   `{"days":[{"date":"2026-09-27","steps":9412},{"date":"2026-09-28","steps":3180}]}`. Each day may also carry
   `distanceMeters` and `activeEnergyKcal`; resending a day replaces it.
2. Run it once by hand with Tailscale on, allowing Health access and choosing Always Allow for the server, so later
   runs need no confirmation.
3. Add personal automations that Run Immediately: when a few everyday apps are opened, and at 17:45.

The Shortcut cannot read Health while the iPhone is locked, so a run then fails and the next one with the phone
unlocked catches up. The pet only warns about missing data after 36 hours without any.

### Tasks

A personal to-do list whose tasks can wait on one another: each tailnet login keeps its own, which
nobody else sees. There are three views of the same tasks:

- **List**: the tasks in stages, each waiting only on tasks in earlier stages, with a checkbox to finish one.
- **Board**: To do, Doing and Done columns. Cards drag between and within columns; on touch each card has a menu.
- **Timeline**: a Gantt chart of the critical-path schedule, from each task's duration, its "not before" date and
  what it waits on, with arrows for dependencies, the critical path in red, due dates and today marked.

The API refuses any dependency that would close a cycle, and only lets a task leave To do once everything it waits
on is done (and a done task reopen only while nothing that waits on it has started). The graph and schedule logic in
`src/plan.ts` is pure and shared by the server and the UI.

From 08:00 London time, anyone with a task overdue, due today or tomorrow, or scheduled to miss its due date gets
one push notification a day, on their own devices only.

#### Manage tasks from Claude

The app serves an MCP server at `https://apps.<tailnet>.ts.net/tasks/mcp` (Streamable HTTP, stateless), with tools
to read your list with its critical-path schedule and to create, edit, move, link and delete tasks. It acts as the
same Tailscale identity as the web app, so it only ever sees your own tasks, and it works from any client on a
tailnet device, e.g. Claude Code:

```sh
claude mcp add --transport http --scope user tasks https://apps.<tailnet>.ts.net/tasks/mcp
```

Clients that connect from the cloud rather than your device, such as claude.ai's custom connectors, cannot reach
the tailnet.

## Deploy your own

Fork the repo. Every push to `main` runs lint, typecheck, the migration check and the tests, then builds
`ghcr.io/<owner>/<repo>:<sha>`. Once a deploy host is configured, CI joins the tailnet as an ephemeral `tag:ci` node
and SSHes to the host with a key that can only run `deploy/deploy.sh`, passing just the commit SHA. The script pulls
that image, unpacks the stack (`deploy/stack/`, baked into the image) into `$APP_DIR/releases/<sha>/`, migrates,
starts the server and worker and waits for their health checks, rolling back to the previous release if they fail.

The stack joins the tailnet as its own device, `apps`, through a Tailscale sidecar. Server, worker, Postgres and
Garage share the sidecar's network and publish nothing on the host itself:

- `https://apps.<tailnet>.ts.net/` is the server
- `https://apps.<tailnet>.ts.net:3900` is S3 (Garage, region `garage`, path-style, bucket `apps`)
- `psql -h apps.<tailnet>.ts.net -U <user> apps` is Postgres

Postgres and Garage keep their data in `$APP_DIR/data`, so back up that directory. On a Synology NAS, put `APP_DIR`
inside a shared folder and Hyper Backup covers it.

### One-time setup

**Tailscale**, in the policy file, where `<host>` is the deploy host's machine name:

```jsonc
"tagOwners": {
    "tag:ci":   ["autogroup:admin"], // ephemeral GitHub Actions runners
    "tag:apps": ["autogroup:admin"], // the stack's sidecar
},
"acls": [
    {"action": "accept", "src": ["autogroup:member"], "dst": ["*:*"]},
    {"action": "accept", "src": ["tag:ci"], "dst": ["<host>:22"]},
],
```

- An OAuth client with the Auth Keys write scope for `tag:ci`, for CI.
- A one-off auth key for the sidecar: not reusable, not ephemeral, pre-approved, tagged `tag:apps`. It is only
  used on first start; the sidecar keeps its identity in the `tailscale-state` volume after that.

**Deploy host**, any Linux machine on the tailnet with Docker Compose:

- Pick an `APP_DIR`, say `/srv/apps`, and copy [`deploy/.env.example`](deploy/.env.example) to `$APP_DIR/.env`.
  Fill it in: your tailnet's DNS name, the sidecar's auth key, and secrets for Postgres, Garage and Web Push.
  Generate the Web Push pair once; changing it invalidates every subscription.
- If the image is private, log in to GHCR with a classic PAT that has only `read:packages`:
  `docker login ghcr.io -u <github-user>`
- Install the deploy script:

  ```sh
  ssh <host> 'mkdir -p ~/bin && cat > ~/bin/apps-deploy && chmod 755 ~/bin/apps-deploy' < deploy/deploy.sh
  ```

  Generate a key pair for CI and authorise it, in the host's `~/.ssh/authorized_keys`, to run that script and
  nothing else. The forced command also sets which image the host deploys and where:

  ```
  command="IMAGE=ghcr.io/<owner>/<repo> APP_DIR=/srv/apps /home/<user>/bin/apps-deploy",restrict ssh-ed25519 AAAA… apps-ci
  ```

**GitHub**, in the repo's settings:

- Repository variables: `DEPLOY_HOST` (the host's tailnet name, e.g. `<host>.<tailnet>.ts.net`), `DEPLOY_USER`,
  and `DEPLOY_KNOWN_HOST`, the host's line for `known_hosts` (`ssh-keyscan -t ed25519 <host>.<tailnet>.ts.net`).
  CI skips the deploy until `DEPLOY_HOST` is set.
- Secrets in a `production` environment: `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` from the OAuth client, and
  `DEPLOY_SSH_KEY`, the private half of the CI key.
