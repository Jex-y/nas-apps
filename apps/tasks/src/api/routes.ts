import { defineRoutes, type IdentityMode, parseBody, parseParam, resolveViewer } from "@nas/core";
import { z } from "zod";
import { CreateTask, MoveTask, type ProjectView, SaveProject, UpdateTask } from "../contract";
import type { TasksService } from "./service";

export type TasksRoutesDeps = {
  readonly service: TasksService;
  readonly identity: IdentityMode;
};

const id = (value: string) => parseParam(value, z.uuid());

export const createTasksRoutes = ({ service, identity }: TasksRoutesDeps) => {
  /** Every change answers with the project as it now is. */
  const respond =
    <R extends Request>(change: (request: R) => Promise<ProjectView>, status = 200) =>
    async (request: R) => {
      resolveViewer(identity, request);
      return Response.json(await change(request), { status });
    };

  return defineRoutes({
    "/tasks/api/projects": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await service.listProjects());
      },
      POST: respond(async (request) => service.createProject(await parseBody(request, SaveProject)), 201),
    },
    "/tasks/api/projects/:id": {
      GET: respond((request) => service.getProject(id(request.params.id))),
      PATCH: respond(async (request) =>
        service.renameProject(id(request.params.id), await parseBody(request, SaveProject)),
      ),
      DELETE: async (request) => {
        resolveViewer(identity, request);
        await service.deleteProject(id(request.params.id));
        return new Response(null, { status: 204 });
      },
    },
    "/tasks/api/projects/:id/tasks": {
      POST: respond(
        async (request) => service.createTask(id(request.params.id), await parseBody(request, CreateTask)),
        201,
      ),
    },
    "/tasks/api/tasks/:id": {
      PATCH: respond(async (request) =>
        service.updateTask(id(request.params.id), await parseBody(request, UpdateTask)),
      ),
      DELETE: respond((request) => service.deleteTask(id(request.params.id))),
    },
    "/tasks/api/tasks/:id/move": {
      PUT: respond(async (request) => service.moveTask(id(request.params.id), await parseBody(request, MoveTask))),
    },
    "/tasks/api/tasks/:id/dependencies/:dependsOnId": {
      PUT: respond((request) => service.addDependency(id(request.params.id), id(request.params.dependsOnId))),
      DELETE: respond((request) => service.removeDependency(id(request.params.id), id(request.params.dependsOnId))),
    },
  });
};
