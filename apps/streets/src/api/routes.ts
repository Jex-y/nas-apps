import {
  defineRoutes,
  HttpError,
  type IdentityMode,
  parseBody,
  parseParam,
  parseQuery,
  resolveViewer,
} from "@apps/core";
import { z } from "zod";
import { type ConnectOutcome, MAX_UPLOAD_BYTES, UpdateStrava } from "../contract";
import type { GpxUpload, StravaAnswer, StreetsService } from "./service";

export type StreetsRoutesDeps = {
  readonly service: StreetsService;
  readonly identity: IdentityMode;
};

/** The runs list shows this many, newest first. */
const ACTIVITY_LIMIT = 300;

const redirectTo = (location: string) => new Response(null, { status: 302, headers: { Location: location } });
const connectPage = (outcome: ConnectOutcome) => redirectTo(`/streets/connect?strava=${outcome}`);

const Coordinate = (limit: number) => z.coerce.number().min(-limit).max(limit);

const Viewport = z
  .object({ south: Coordinate(90), west: Coordinate(180), north: Coordinate(90), east: Coordinate(180) })
  .refine((box) => box.north > box.south && box.east > box.west, { message: "The box is inside out" });

const Start = z.object({ lat: Coordinate(90), lon: Coordinate(180) });

/** Strava answers with `error` when the athlete refuses, and with `code` and the scopes granted otherwise. */
const Callback = z
  .object({
    state: z.string().default(""),
    error: z.string().optional(),
    code: z.string().min(1).optional(),
    scope: z.string().default(""),
  })
  .transform(({ state, error, code, scope }, context): { state: string; answer: StravaAnswer } => {
    if (error !== undefined) {
      return { state, answer: { kind: "denied" } };
    }
    if (code === undefined) {
      context.addIssue({ code: "custom", message: "Strava sent no authorisation code" });
      return z.NEVER;
    }
    return { state, answer: { kind: "granted", code, scopes: scope.split(",") } };
  });

const uploadOf = async (file: File): Promise<GpxUpload> => ({
  filename: file.name,
  bytes: new Uint8Array(await file.arrayBuffer()),
  modifiedAt: file.lastModified ? new Date(file.lastModified) : null,
});

export const createStreetsRoutes = ({ service, identity }: StreetsRoutesDeps) => {
  const login = (request: Request) => resolveViewer(identity, request).login;

  return defineRoutes({
    "/streets/api/strava": {
      GET: async (request) => Response.json(await service.stravaStatus(login(request))),
      PATCH: async (request) => {
        const owner = login(request);
        return Response.json(await service.setIncluded(owner, await parseBody(request, UpdateStrava)));
      },
      DELETE: async (request) => {
        await service.disconnect(login(request));
        return new Response(null, { status: 204 });
      },
    },
    "/streets/api/strava/connect": {
      GET: (request) => redirectTo(service.authorizeUrl(login(request))),
    },
    "/streets/api/strava/callback": {
      GET: async (request) => {
        const owner = login(request);
        const { state, answer } = parseQuery(request, Callback);
        return connectPage(await service.finishConnecting(owner, state, answer));
      },
    },
    "/streets/api/strava/backfill": {
      POST: async (request) => {
        await service.restartBackfill(login(request));
        return new Response(null, { status: 202 });
      },
    },
    "/streets/api/uploads": {
      POST: async (request) => {
        const owner = login(request);
        if (Number(request.headers.get("Content-Length") ?? 0) > MAX_UPLOAD_BYTES) {
          throw new HttpError(413, "Upload files one at a time, each under 30 MB");
        }
        const files = (await request.formData()).getAll("file").filter((file) => file instanceof File);
        if (files.length === 0) {
          throw new HttpError(400, "Expected GPX files in the `file` field");
        }
        return Response.json(await service.importGpx(owner, await Promise.all(files.map(uploadOf))), { status: 201 });
      },
    },
    "/streets/api/map": {
      GET: async (request) => {
        const owner = login(request);
        return Response.json({ streets: await service.map(owner, parseQuery(request, Viewport)) });
      },
    },
    "/streets/api/stats": {
      GET: async (request) => Response.json(await service.stats(login(request))),
    },
    "/streets/api/suggestions": {
      GET: async (request) => {
        const owner = login(request);
        const { lat, lon } = parseQuery(request, Start);
        return Response.json(await service.suggestions(owner, [lat, lon]));
      },
    },
    "/streets/api/activities": {
      GET: async (request) => Response.json(await service.activities(login(request), ACTIVITY_LIMIT)),
    },
    "/streets/api/activities/rematch": {
      POST: async (request) => {
        await service.rematch(login(request));
        return new Response(null, { status: 202 });
      },
    },
    "/streets/api/network": {
      GET: async (request) => {
        login(request);
        return Response.json(await service.networkStatus());
      },
    },
    "/streets/api/network/refresh": {
      POST: async (request) => {
        login(request);
        await service.refreshNetwork();
        return new Response(null, { status: 202 });
      },
    },
    "/streets/api/streets/:id/nodes": {
      GET: async (request) => {
        const owner = login(request);
        const streetId = parseParam(request.params.id, z.coerce.number().int().positive());
        return Response.json(await service.streetNodes(owner, streetId));
      },
    },
    "/streets/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
};
