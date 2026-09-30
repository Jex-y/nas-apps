import { defineRoutes, type IdentityMode, resolveViewer } from "@apps/core";
import type { StatusReport } from "../contract";

export type StatusRoutesDeps = {
  readonly identity: IdentityMode;
  readonly report: () => Promise<StatusReport>;
};

export const createStatusRoutes = ({ identity, report }: StatusRoutesDeps) =>
  defineRoutes({
    "/status/api/report": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await report(), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
    "/status/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
