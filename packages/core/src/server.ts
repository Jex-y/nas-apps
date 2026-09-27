import { type AppModule, routePaths, serveRoutes } from "./app-module";
import { errorResponse } from "./http";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const landingPage = (apps: readonly AppModule[]): Response =>
  new Response(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Apps</title>
<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}main{max-width:40rem;margin:0 auto;padding:2rem 1rem}</style></head>
<body><main><h1>Apps</h1><ul>${apps
      .map((app) => `<li><a href="/${escapeHtml(app.slug)}/">${escapeHtml(app.title)}</a></li>`)
      .join("")}</ul></main></body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

const mergeAppRoutes = (apps: readonly AppModule[]): Bun.Serve.Routes<undefined, string> => {
  const slugs = apps.map((app) => app.slug);
  const duplicate = slugs.find((slug, index) => slugs.indexOf(slug) !== index);
  if (duplicate !== undefined) {
    throw new Error(`Two apps share the slug "${duplicate}"`);
  }
  for (const app of apps) {
    const stray = routePaths(app.routes).find((path) => path !== `/${app.slug}` && !path.startsWith(`/${app.slug}/`));
    if (stray !== undefined) {
      throw new Error(`App "${app.slug}" declares route "${stray}" outside /${app.slug}/`);
    }
  }
  return Object.assign({}, ...apps.map((app) => serveRoutes(app.routes)));
};

export type ServerOptions = {
  readonly port: number;
  readonly development: boolean;
  readonly apps: readonly AppModule[];
};

export const startServer = ({ port, development, apps }: ServerOptions): Bun.Server<undefined> =>
  Bun.serve({
    port,
    development,
    routes: {
      "/": landingPage(apps),
      "/healthz": new Response("ok"),
      ...mergeAppRoutes(apps),
    },
    fetch: () => Response.json({ error: "Not found" }, { status: 404 }),
    error: errorResponse,
  });
