import { defineRoutes, resolveViewer } from "@nas/core";
import { createStatusReporter, type StatusDeps } from "./report";

export const createStatusRoutes = (deps: StatusDeps) => {
  const report = createStatusReporter(deps);

  return defineRoutes({
    "/status/api/report": {
      GET: async (request) => {
        resolveViewer(deps.context.identity, request);
        return Response.json(await report(), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
    "/status/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
};
