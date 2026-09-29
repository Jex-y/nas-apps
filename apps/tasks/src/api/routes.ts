import { defineRoutes, type IdentityMode, parseBody, parseParam, resolveViewer } from "@apps/core";
import { z } from "zod";
import { CreateTask, MoveTask, type TaskList, UpdateTask } from "../contract";
import type { TasksService } from "./service";

export type TasksRoutesDeps = {
  readonly service: TasksService;
  readonly identity: IdentityMode;
};

const id = (value: string) => parseParam(value, z.uuid());

export const createTasksRoutes = ({ service, identity }: TasksRoutesDeps) => {
  /** Every request acts on the viewer's own list, and answers with that list as it now is. */
  const respond =
    <R extends Request>(handle: (owner: string, request: R) => Promise<TaskList>, status = 200) =>
    async (request: R) => {
      const { login } = resolveViewer(identity, request);
      return Response.json(await handle(login, request), { status });
    };

  return defineRoutes({
    "/tasks/api/tasks": {
      GET: respond((owner) => service.list(owner)),
      POST: respond(async (owner, request) => service.createTask(owner, await parseBody(request, CreateTask)), 201),
    },
    "/tasks/api/tasks/:id": {
      PATCH: respond(async (owner, request) =>
        service.updateTask(owner, id(request.params.id), await parseBody(request, UpdateTask)),
      ),
      DELETE: respond((owner, request) => service.deleteTask(owner, id(request.params.id))),
    },
    "/tasks/api/tasks/:id/move": {
      PUT: respond(async (owner, request) =>
        service.moveTask(owner, id(request.params.id), await parseBody(request, MoveTask)),
      ),
    },
    "/tasks/api/tasks/:id/dependencies/:dependsOnId": {
      PUT: respond((owner, request) =>
        service.addDependency(owner, id(request.params.id), id(request.params.dependsOnId)),
      ),
      DELETE: respond((owner, request) =>
        service.removeDependency(owner, id(request.params.id), id(request.params.dependsOnId)),
      ),
    },
  });
};
