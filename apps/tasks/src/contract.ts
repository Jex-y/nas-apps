import { z } from "zod";

export const TASKS_API = "/tasks/api";

/** The board's columns, left to right. A task may only leave `todo` once everything it depends on is `done`. */
export const STATUSES = ["todo", "doing", "done"] as const;
export type Status = (typeof STATUSES)[number];

const LocalDate = z.iso.date();
const count = z.number().int().nonnegative();
const ProjectName = z.string().trim().min(1).max(80);
const Title = z.string().trim().min(1).max(200);
const Notes = z.string().max(10_000);
export const DurationDays = z.number().int().min(1).max(365);

export const Task = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string(),
  status: z.enum(STATUSES),
  /** The estimate the timeline schedules with. */
  durationDays: count,
  /** The earliest day work may begin, whatever the dependencies allow. */
  startOn: LocalDate.nullable(),
  /** The last day the task may still be worked on. */
  dueOn: LocalDate.nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  /** Tasks that must be done before this one can start. Always acyclic, and always within the project. */
  dependsOn: z.array(z.uuid()),
});
export type Task = z.infer<typeof Task>;

export const ProjectSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  counts: z.object({ todo: count, doing: count, done: count }),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectList = z.array(ProjectSummary);

export const ProjectView = z.object({
  id: z.uuid(),
  name: z.string(),
  /** In board order: by column, then top to bottom. */
  tasks: z.array(Task),
});
export type ProjectView = z.infer<typeof ProjectView>;

export const SaveProject = z.object({ name: ProjectName });
export type SaveProject = z.infer<typeof SaveProject>;

export const CreateTask = z.object({
  title: Title,
  notes: Notes.default(""),
  durationDays: DurationDays.default(1),
  startOn: LocalDate.nullable().default(null),
  dueOn: LocalDate.nullable().default(null),
  dependsOn: z.array(z.uuid()).max(100).default([]),
});
export type CreateTask = z.input<typeof CreateTask>;
export type NewTask = z.output<typeof CreateTask>;

export const UpdateTask = z
  .object({
    title: Title.optional(),
    notes: Notes.optional(),
    durationDays: DurationDays.optional(),
    startOn: LocalDate.nullable().optional(),
    dueOn: LocalDate.nullable().optional(),
  })
  .refine((update) => Object.keys(update).length > 0, { message: "Nothing to update" });
export type UpdateTask = z.infer<typeof UpdateTask>;

/** Puts a task in a column, above `beforeId`, or at the bottom when that is `null`. */
export const MoveTask = z.object({ status: z.enum(STATUSES), beforeId: z.uuid().nullable() });
export type MoveTask = z.infer<typeof MoveTask>;
