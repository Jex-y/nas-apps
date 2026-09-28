import { z } from "zod";

export const STATUS_API = "/status/api";

/** How often the page asks for a fresh report. */
export const REFRESH_MS = 15_000;

const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();

/** A part of the report that depends on a service which may be unreachable, so it can fail on its own. */
const probed = <S extends z.ZodType>(value: S) =>
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), value }),
    z.object({ status: z.literal("down"), error: z.string() }),
  ]);

export const ServerInfo = z.object({
  /** The commit the running image was built from; null outside a CI build. */
  commit: z.string().nullable(),
  bunVersion: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type ServerInfo = z.infer<typeof ServerInfo>;

export const SchemaSize = z.object({ name: z.string(), bytes: count });

export const PostgresInfo = z.object({
  latencyMs: z.number().nonnegative(),
  version: z.string(),
  databaseBytes: count,
  schemas: z.array(SchemaSize),
});
export type PostgresInfo = z.infer<typeof PostgresInfo>;

export const Reachable = z.object({ latencyMs: z.number().nonnegative() });

export const Outcomes = z.object({
  completed: count,
  retrying: count,
  dead: count,
});
export type Outcomes = z.infer<typeof Outcomes>;

export const JobSummary = z.object({
  name: z.string(),
  /** False for rows no app handles any more; no worker will ever claim them. */
  registered: z.boolean(),
  running: count,
  ready: count,
  waiting: count,
  retrying: count,
  dead: count,
  oldestReadyAt: timestamp.nullable(),
  last24h: Outcomes,
});
export type JobSummary = z.infer<typeof JobSummary>;

export const HourlyOutcomes = Outcomes.extend({ hour: timestamp });
export type HourlyOutcomes = z.infer<typeof HourlyOutcomes>;

const failure = {
  id: z.uuid(),
  name: z.string(),
  attempts: count,
  maxAttempts: count,
  error: z.string(),
  failedAt: timestamp.nullable(),
};

export const JobFailure = z.discriminatedUnion("state", [
  z.object({
    ...failure,
    state: z.literal("retrying"),
    nextAttemptAt: timestamp,
  }),
  z.object({ ...failure, state: z.literal("dead") }),
]);
export type JobFailure = z.infer<typeof JobFailure>;

export const JobQueue = z.object({
  jobs: z.array(JobSummary),
  hourly: z.array(HourlyOutcomes),
  recentFailures: z.array(JobFailure),
});
export type JobQueue = z.infer<typeof JobQueue>;

export const ScheduleStatus = z.object({
  name: z.string(),
  everyMs: z.number().int().positive(),
  jitterMs: z.number().int().nonnegative(),
  lastEnqueued: z.object({ slotStartedAt: timestamp, runAt: timestamp }).nullable(),
  next: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("scheduled"), runAt: timestamp }),
    z.object({ kind: z.literal("overdue"), slotStartedAt: timestamp }),
  ]),
});
export type ScheduleStatus = z.infer<typeof ScheduleStatus>;

export const MigrationState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current"), applied: count }),
  z.object({ kind: z.literal("pending"), applied: count, pending: count }),
  z.object({ kind: z.literal("ahead"), applied: count, unknown: count }),
]);

export const Migrations = z.object({ slug: z.string(), state: MigrationState });
export type Migrations = z.infer<typeof Migrations>;

export const AppSummary = z.object({
  slug: z.string(),
  title: z.string(),
  jobs: count,
  schedules: count,
});
export type AppSummary = z.infer<typeof AppSummary>;

export const StatusReport = z.object({
  generatedAt: timestamp,
  server: ServerInfo,
  postgres: probed(PostgresInfo),
  blob: probed(Reachable),
  queue: probed(JobQueue),
  schedules: probed(z.array(ScheduleStatus)),
  migrations: probed(z.array(Migrations)),
  apps: z.array(AppSummary),
});
export type StatusReport = z.infer<typeof StatusReport>;

export type Probed<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "down"; readonly error: string };
