import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HttpError } from "@nas/core";
import { z } from "zod";
import { CreateTask, DurationDays, type ProjectView, SaveProject, STATUSES, UpdateTask } from "../contract";
import { blockers, dateOfDay, schedule, topologicalOrder } from "../plan";
import { londonDay } from "./calendar";
import type { TasksService } from "./service";

export type TasksMcpDeps = {
  readonly service: TasksService;
  readonly now: () => Date;
};

const INSTRUCTIONS = `A to-do list whose tasks depend on one another, grouped into projects shared by the household.

- A task waits on the tasks in its dependsOn; the graph never has a cycle and never crosses projects.
- Status is todo, doing or done. A task can only leave todo once everything it waits on is done, and a done task
  can only be reopened while nothing that waits on it has started.
- Each task has a duration estimate in days, an optional startOn (not before) and dueOn (last day to work on it).
- Every project answer includes a critical-path schedule from today: each task's scheduled first and last day, its
  slack in days (negative when it will miss a due date) and whether it is critical.
- Every change answers with the whole project as it now is. Ids are UUIDs; find them with list_projects and get_project.`;

const ProjectId = z.uuid().describe("The project's id");
const TaskId = z.uuid().describe("The task's id");
const LocalDate = z.iso.date();

/** The project as the model reads it: tasks in dependency order, each with its schedule. */
const planOf = (view: ProjectView, today: number) => {
  const slots = schedule(view.tasks, today, londonDay);
  const byId = new Map(view.tasks.map((task) => [task.id, task]));
  const open = view.tasks.flatMap((task) => (task.status === "done" ? [] : (slots.get(task.id) ?? [])));
  return {
    id: view.id,
    name: view.name,
    today: dateOfDay(today),
    finishesOn: open.length === 0 ? null : dateOfDay(Math.max(...open.map((slot) => slot.finish)) - 1),
    tasks: topologicalOrder(view.tasks).map((task) => {
      const slot = slots.get(task.id);
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        ...(task.notes !== "" && { notes: task.notes }),
        durationDays: task.durationDays,
        startOn: task.startOn,
        dueOn: task.dueOn,
        dependsOn: task.dependsOn,
        waitingOn: task.status === "done" ? [] : blockers(task, byId).map((blocker) => blocker.id),
        scheduled: slot && {
          firstDay: dateOfDay(slot.start),
          lastDay: dateOfDay(slot.finish - 1),
          slackDays: slot.slack,
          critical: slot.critical,
        },
      };
    }),
  };
};

const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/** Refusals go back to the model as tool errors it can read and act on, rather than protocol failures. */
const run = async (work: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return text(await work());
  } catch (error) {
    if (error instanceof HttpError) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
    throw error;
  }
};

const createServer = ({ service, now }: TasksMcpDeps): McpServer => {
  const server = new McpServer({ name: "nas-tasks", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const plan = async (view: Promise<ProjectView>) => planOf(await view, londonDay(now()));

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const destroy = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

  server.registerTool(
    "list_projects",
    { description: "Lists every project with how many of its tasks are in each status.", annotations: readOnly },
    () => run(() => service.listProjects()),
  );
  server.registerTool(
    "get_project",
    {
      description: "Reads a project's tasks in dependency order, with what each waits on and its schedule.",
      inputSchema: { projectId: ProjectId },
      annotations: readOnly,
    },
    ({ projectId }) => run(() => plan(service.getProject(projectId))),
  );
  server.registerTool(
    "create_project",
    { description: "Creates an empty project.", inputSchema: SaveProject.shape, annotations: change },
    (input) => run(() => plan(service.createProject(input))),
  );
  server.registerTool(
    "rename_project",
    {
      description: "Renames a project.",
      inputSchema: { projectId: ProjectId, ...SaveProject.shape },
      annotations: { ...change, idempotentHint: true },
    },
    ({ projectId, ...input }) => run(() => plan(service.renameProject(projectId, input))),
  );
  server.registerTool(
    "delete_project",
    {
      description: "Deletes a project and all of its tasks for everyone. Cannot be undone.",
      inputSchema: { projectId: ProjectId },
      annotations: destroy,
    },
    ({ projectId }) => run(() => service.deleteProject(projectId).then(() => ({ deleted: projectId }))),
  );
  server.registerTool(
    "create_task",
    {
      description: "Adds a task at the bottom of a project's todo column.",
      inputSchema: {
        projectId: ProjectId,
        title: CreateTask.shape.title,
        notes: CreateTask.shape.notes,
        durationDays: CreateTask.shape.durationDays.describe("Estimated working days, 1 to 365"),
        startOn: CreateTask.shape.startOn.describe("Earliest day work may begin, YYYY-MM-DD"),
        dueOn: CreateTask.shape.dueOn.describe("Last day the task may be worked on, YYYY-MM-DD"),
        dependsOn: CreateTask.shape.dependsOn.describe("Ids of tasks in the same project that must be done first"),
      },
      annotations: change,
    },
    ({ projectId, ...input }) => run(() => plan(service.createTask(projectId, input))),
  );
  server.registerTool(
    "update_task",
    {
      description: "Changes a task's details. Only the fields given change; send null to clear a date.",
      inputSchema: {
        taskId: TaskId,
        title: z.string().trim().min(1).max(200).optional(),
        notes: z.string().max(10_000).optional(),
        durationDays: DurationDays.optional(),
        startOn: LocalDate.nullable().optional().describe("Earliest day work may begin, YYYY-MM-DD"),
        dueOn: LocalDate.nullable().optional().describe("Last day the task may be worked on, YYYY-MM-DD"),
      },
      annotations: { ...change, idempotentHint: true },
    },
    ({ taskId, ...fields }) =>
      run(async () => {
        const update = UpdateTask.safeParse(fields);
        if (!update.success) {
          throw new HttpError(400, z.prettifyError(update.error));
        }
        return plan(service.updateTask(taskId, update.data));
      }),
  );
  server.registerTool(
    "move_task",
    {
      description:
        "Sets a task's status, which moves it between board columns. Refused while it waits on unfinished tasks.",
      inputSchema: {
        taskId: TaskId,
        status: z.enum(STATUSES),
        beforeId: z
          .uuid()
          .nullable()
          .default(null)
          .describe("A task already in that column to place it above; the bottom of the column when omitted"),
      },
      annotations: { ...change, idempotentHint: true },
    },
    ({ taskId, ...move }) => run(() => plan(service.moveTask(taskId, move))),
  );
  server.registerTool(
    "delete_task",
    {
      description: "Deletes a task; tasks that waited on it stop doing so. Cannot be undone.",
      inputSchema: { taskId: TaskId },
      annotations: destroy,
    },
    ({ taskId }) => run(() => plan(service.deleteTask(taskId))),
  );
  server.registerTool(
    "add_dependency",
    {
      description: "Makes a task wait on another in the same project. Refused if it would create a cycle.",
      inputSchema: { taskId: TaskId, dependsOnId: z.uuid().describe("The task that must be done first") },
      annotations: { ...change, idempotentHint: true },
    },
    ({ taskId, dependsOnId }) => run(() => plan(service.addDependency(taskId, dependsOnId))),
  );
  server.registerTool(
    "remove_dependency",
    {
      description: "Stops a task waiting on another.",
      inputSchema: { taskId: TaskId, dependsOnId: z.uuid().describe("The task it should no longer wait on") },
      annotations: { ...change, idempotentHint: true },
    },
    ({ taskId, dependsOnId }) => run(() => plan(service.removeDependency(taskId, dependsOnId))),
  );
  return server;
};

/**
 * Serves MCP over Streamable HTTP, statelessly: each request gets its own server and transport, and answers with
 * plain JSON, so nothing is held between requests and any server instance can answer.
 */
export const handleMcp =
  (deps: TasksMcpDeps) =>
  async (request: Request): Promise<Response> => {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await createServer(deps).connect(transport);
    return transport.handleRequest(request);
  };
