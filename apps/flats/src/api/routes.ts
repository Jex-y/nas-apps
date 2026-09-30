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
import {
  AddListing,
  CreateDestination,
  CreateSearch,
  CreateViewing,
  MapBounds,
  PROPERTY_STATUSES,
  Requirements,
  TrialRequest,
  UpdateNotes,
  UpdateSearch,
  UpdateStatus,
} from "../contract";
import type { FlatsService } from "./service";

export type FlatsRoutesDeps = {
  readonly service: FlatsService;
  readonly identity: IdentityMode;
};

const id = (value: string) => parseParam(value, z.uuid());
const noContent = () => new Response(null, { status: 204 });
const redirectTo = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

export const createFlatsRoutes = ({ service, identity }: FlatsRoutesDeps) => {
  /** Every route needs a tailnet identity; only viewings record whose it was. */
  const viewer =
    <R extends Request>(handle: (request: R, login: string) => Promise<Response>) =>
    async (request: R) =>
      handle(request, resolveViewer(identity, request).login);

  return defineRoutes({
    "/flats/api/properties": {
      GET: viewer(async (request) => {
        const status = new URL(request.url).searchParams.get("status");
        return Response.json(
          await service.properties(status === null ? null : parseParam(status, z.enum(PROPERTY_STATUSES))),
        );
      }),
    },
    "/flats/api/properties/:id": {
      GET: viewer(async (request) => Response.json(await service.property(id(request.params.id)))),
    },
    "/flats/api/properties/:id/status": {
      PUT: viewer(async (request) => {
        const propertyId = id(request.params.id);
        await service.setStatus(propertyId, await parseBody(request, UpdateStatus));
        return noContent();
      }),
    },
    "/flats/api/properties/:id/notes": {
      PUT: viewer(async (request) => {
        const propertyId = id(request.params.id);
        await service.setNotes(propertyId, (await parseBody(request, UpdateNotes)).notes);
        return noContent();
      }),
    },
    "/flats/api/properties/:id/viewings": {
      POST: viewer(async (request, login) => {
        const propertyId = id(request.params.id);
        await service.addViewing(propertyId, await parseBody(request, CreateViewing), login);
        return new Response(null, { status: 201 });
      }),
    },
    "/flats/api/viewings/:id": {
      DELETE: viewer(async (request) => {
        await service.deleteViewing(id(request.params.id));
        return noContent();
      }),
    },
    "/flats/api/viewings/:id/photos": {
      POST: viewer(async (request) => {
        const viewingId = id(request.params.id);
        const file = (await request.formData()).get("file");
        if (!(file instanceof File) || file.size === 0) {
          throw new HttpError(400, "Expected a non-empty file in the `file` field");
        }
        await service.addViewingPhoto(viewingId, file);
        return new Response(null, { status: 201 });
      }),
    },
    "/flats/api/viewing-photos/:id": {
      GET: viewer(async (request) => redirectTo(await service.viewingPhotoUrl(id(request.params.id)))),
      DELETE: viewer(async (request) => {
        await service.deleteViewingPhoto(id(request.params.id));
        return noContent();
      }),
    },
    "/flats/api/photos/:id": {
      GET: viewer(async (request) => redirectTo(await service.photoUrl(id(request.params.id)))),
    },
    "/flats/api/searches": {
      GET: viewer(async () => Response.json(await service.searches())),
      POST: viewer(async (request) =>
        Response.json(await service.createSearch(await parseBody(request, CreateSearch)), { status: 201 }),
      ),
    },
    "/flats/api/searches/:id": {
      PATCH: viewer(async (request) => {
        const searchId = id(request.params.id);
        const { enabled } = await parseBody(request, UpdateSearch);
        return Response.json(await service.setSearchEnabled(searchId, enabled));
      }),
      DELETE: viewer(async (request) => {
        await service.deleteSearch(id(request.params.id));
        return noContent();
      }),
    },
    "/flats/api/listings": {
      POST: viewer(async (request) =>
        Response.json(await service.addListing((await parseBody(request, AddListing)).url), { status: 202 }),
      ),
    },
    "/flats/api/requirements/workbench": {
      GET: viewer(async () => Response.json(await service.workbench())),
    },
    "/flats/api/requirements": {
      GET: viewer(async () => Response.json(await service.requirements())),
      PUT: viewer(async (request) =>
        Response.json(await service.saveRequirements(await parseBody(request, Requirements))),
      ),
    },
    "/flats/api/requirements/trial": {
      POST: viewer(async (request) =>
        Response.json(await service.trial(await parseBody(request, TrialRequest), request.signal)),
      ),
    },
    "/flats/api/map": {
      GET: viewer(async () => Response.json(await service.mapData())),
    },
    "/flats/api/map/crime": {
      GET: viewer(async (request) => Response.json(await service.crimeCells(parseQuery(request, MapBounds)))),
    },
    "/flats/api/destinations": {
      GET: viewer(async () => Response.json(await service.destinations())),
      POST: viewer(async (request) =>
        Response.json(await service.createDestination(await parseBody(request, CreateDestination)), {
          status: 201,
        }),
      ),
    },
    "/flats/api/destinations/:id": {
      DELETE: viewer(async (request) => {
        await service.deleteDestination(id(request.params.id));
        return noContent();
      }),
    },
    "/flats/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
};
