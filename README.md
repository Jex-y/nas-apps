# nas-apps

Personal apps served from the NAS to the tailnet at `https://nas.tail12605.ts.net/<app>/`.

One Bun server hosts every app. Each app is its own workspace package owning its routes, its Postgres schema,
its migrations and its React UI, so any one of them can move to its own server later.

```
packages/core     shared runtime: config, identity, server, migrations, test harness, web fetch helpers
apps/<slug>       one app: src/api (routes + drizzle schema), src/web (React), src/contract.ts (zod), drizzle/
server            composition root: the app list, the entrypoint, the migrate entrypoint
scripts/build.ts  bundles server + UIs into a self-contained dist/
deploy/           the script the NAS runs for each deploy
```

## Develop

```sh
bun install
bun run db:up        # Postgres on localhost:5499 (dev db `apps`, test db `apps_test`)
bun run db:migrate
bun run dev          # http://localhost:3000, hot reload for server and UI
```

In development the server trusts `DEV_USER` from `.env.development` instead of Tailscale headers.

```sh
bun run lint         # biome; `bun run format` to fix
bun run typecheck
bun test             # against the real test database, migrated by the preload
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

## Add an app

1. Copy `apps/notes` to `apps/<slug>` and rename `notes` throughout: package name, `pgSchema`, route
   prefixes, `drizzle.config.ts`, `migrations.ts`.
2. Delete its `drizzle/` folder and run `bun run --cwd apps/<slug> db:generate --name init`.
3. Add `"@nas/<slug>": "workspace:*"` to `server/package.json`, register the app and its migrations in
   `server/src/apps.ts`, then `bun install`.

The server refuses to start if two apps share a slug or an app declares a route outside `/<slug>/`.

## Deploy

Every push to `main` runs lint, typecheck, the migration check and the tests. It then builds
`ghcr.io/jex-y/nas-apps:<sha>`, joins the tailnet as an ephemeral `tag:ci` node, and SSHes to the NAS with a key
that can only run `deploy/nas-deploy.sh`, passing just the commit SHA. The script pulls that image, unpacks the
stack (`deploy/stack/`, baked into the image) into `/volume1/Ed/app/releases/<sha>/`, migrates, starts the server
and waits for its health check, rolling back to the previous release if it fails.

The stack joins the tailnet as its own device, `apps.tail12605.ts.net`, through a Tailscale sidecar. Server and
Postgres share the sidecar's network and publish nothing on the NAS itself:

- `https://apps.tail12605.ts.net/` is the server
- `psql -h apps.tail12605.ts.net -U <user> apps` is Postgres

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

- `/volume1/Ed/app/.env` holds `POSTGRES_USER`, `POSTGRES_PASSWORD` and `TS_AUTHKEY`.
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
