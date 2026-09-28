import {
  and,
  desc,
  type SQL as Expression,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql as raw,
} from "drizzle-orm";
import { z } from "zod";
import type { JobsDatabase } from "./queue";
import { type Schedule, scheduleSlot, slotRunAt } from "./schedule";
import { hourlyOutcomes, jobs, schedules } from "./schema";
import { type JobOutcome, SCHEDULER_TICK_MS, utcHour } from "./worker";

const HOUR_MS = 60 * 60_000;

/** Pending jobs split by what they are waiting on; `retrying` overlaps the other three. */
export type QueueCounts = {
  /** Held by a worker's lease right now. */
  readonly running: number;
  /** Due, and waiting for a free worker. */
  readonly ready: number;
  /** Not due yet: scheduled for later, or backing off after a failure. */
  readonly waiting: number;
  /** Pending after at least one failed attempt. */
  readonly retrying: number;
  readonly dead: number;
};

export type OutcomeCounts = Readonly<Record<JobOutcome, number>>;

export type JobStats = {
  readonly name: string;
  readonly queue: QueueCounts;
  /** When the longest-waiting ready job fell due; null when none is ready. */
  readonly oldestReadyAt: Date | null;
  /** Attempts that ended each way within the snapshot's window. */
  readonly outcomes: OutcomeCounts;
};

export type HourlyOutcomes = OutcomeCounts & { readonly hour: Date };

type FailedJob = {
  readonly id: string;
  readonly name: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly error: string;
  /** Null for failures recorded before the queue tracked when they happened. */
  readonly failedAt: Date | null;
};

export type JobFailure = FailedJob &
  ({ readonly state: "retrying"; readonly nextAttemptAt: Date } | { readonly state: "dead" });

export type JobQueueSnapshot = {
  readonly observedAt: Date;
  /** Every job name with queued rows or outcomes in the window, by name. */
  readonly jobs: readonly JobStats[];
  /** One entry per UTC hour of the window, oldest first; the last is the hour in progress. */
  readonly hourly: readonly HourlyOutcomes[];
  /** Pending and dead jobs with a recorded error, most recent first. */
  readonly recentFailures: readonly JobFailure[];
};

export type JobQueueSnapshotOptions = {
  /** Defaults to the database clock, which is the one the worker schedules against. */
  readonly now?: Date;
  readonly windowHours?: number;
  readonly failureLimit?: number;
};

export const ZERO_OUTCOMES: OutcomeCounts = {
  completed: 0,
  retrying: 0,
  dead: 0,
};
export const ZERO_QUEUE: QueueCounts = {
  running: 0,
  ready: 0,
  waiting: 0,
  retrying: 0,
  dead: 0,
};

const DatabaseNow = z.tuple([z.object({ now: z.date() })]);

const databaseNow = async (db: JobsDatabase): Promise<Date> =>
  DatabaseNow.parse(await db.execute(raw`select now() as now`))[0].now;

const countWhere = (condition: Expression | undefined) =>
  raw<number>`count(*) filter (where ${condition})`.mapWith(Number);

const sumOutcome = (outcome: JobOutcome) =>
  raw<number>`coalesce(sum(${hourlyOutcomes.count}) filter (where ${hourlyOutcomes.outcome} = ${outcome}), 0)`.mapWith(
    Number,
  );

const outcomeColumns = {
  completed: sumOutcome("completed"),
  retrying: sumOutcome("retrying"),
  dead: sumOutcome("dead"),
};

const outcomeCounts = (row: OutcomeCounts | undefined): OutcomeCounts =>
  row === undefined ? ZERO_OUTCOMES : { completed: row.completed, retrying: row.retrying, dead: row.dead };

const toFailure = (
  row: Omit<FailedJob, "error"> & {
    readonly state: "pending" | "dead";
    readonly runAt: Date;
  },
  error: string,
): JobFailure => {
  const failed: FailedJob = {
    id: row.id,
    name: row.name,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    error,
    failedAt: row.failedAt,
  };
  return row.state === "dead"
    ? { ...failed, state: "dead" }
    : { ...failed, state: "retrying", nextAttemptAt: row.runAt };
};

export const readJobQueue = async (
  db: JobsDatabase,
  { now: pinned, windowHours = 24, failureLimit = 20 }: JobQueueSnapshotOptions = {},
): Promise<JobQueueSnapshot> => {
  const now = pinned ?? (await databaseNow(db));
  const firstHour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - (windowHours - 1) * HOUR_MS);

  const pending = eq(jobs.state, "pending");
  const unleased = or(isNull(jobs.lockedUntil), lte(jobs.lockedUntil, now));
  const ready = and(pending, unleased, lte(jobs.runAt, now));
  const inWindow = gte(hourlyOutcomes.hour, utcHour(firstHour));

  const [queued, outcomes, hourly, failures] = await Promise.all([
    db
      .select({
        name: jobs.name,
        running: countWhere(and(pending, gt(jobs.lockedUntil, now))),
        ready: countWhere(ready),
        waiting: countWhere(and(pending, unleased, gt(jobs.runAt, now))),
        retrying: countWhere(and(pending, isNotNull(jobs.lastError))),
        dead: countWhere(eq(jobs.state, "dead")),
        oldestReadyAt: raw<Date | null>`min(${jobs.runAt}) filter (where ${ready})`.mapWith(jobs.runAt),
      })
      .from(jobs)
      .groupBy(jobs.name),
    db
      .select({ name: hourlyOutcomes.name, ...outcomeColumns })
      .from(hourlyOutcomes)
      .where(inWindow)
      .groupBy(hourlyOutcomes.name),
    db
      .select({ hour: hourlyOutcomes.hour, ...outcomeColumns })
      .from(hourlyOutcomes)
      .where(inWindow)
      .groupBy(hourlyOutcomes.hour),
    db
      .select({
        id: jobs.id,
        name: jobs.name,
        state: jobs.state,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        lastError: jobs.lastError,
        failedAt: jobs.failedAt,
        runAt: jobs.runAt,
      })
      .from(jobs)
      .where(isNotNull(jobs.lastError))
      .orderBy(raw`${jobs.failedAt} desc nulls last`, desc(jobs.createdAt))
      .limit(failureLimit),
  ]);

  const queuedByName = new Map(queued.map((row) => [row.name, row]));
  const outcomesByName = new Map(outcomes.map((row) => [row.name, row]));
  const hourlyByTime = new Map(hourly.map((row) => [row.hour.getTime(), row]));

  return {
    observedAt: now,
    jobs: [...new Set([...queuedByName.keys(), ...outcomesByName.keys()])].sort().map((name) => {
      const row = queuedByName.get(name);
      return {
        name,
        queue:
          row === undefined
            ? ZERO_QUEUE
            : {
                running: row.running,
                ready: row.ready,
                waiting: row.waiting,
                retrying: row.retrying,
                dead: row.dead,
              },
        oldestReadyAt: row?.oldestReadyAt ?? null,
        outcomes: outcomeCounts(outcomesByName.get(name)),
      };
    }),
    hourly: Array.from({ length: windowHours }, (_, index) => {
      const hour = new Date(firstHour.getTime() + index * HOUR_MS);
      return { hour, ...outcomeCounts(hourlyByTime.get(hour.getTime())) };
    }),
    recentFailures: failures.flatMap((row) => (row.lastError === null ? [] : [toFailure(row, row.lastError)])),
  };
};

/** A slot the scheduler enqueued, and when that slot's job was due to run. */
export type EnqueuedSlot = {
  readonly slotStartedAt: Date;
  readonly runAt: Date;
};

export type NextRun =
  | { readonly kind: "scheduled"; readonly runAt: Date }
  /** The current slot is still unclaimed after several scheduler ticks, so no scheduler is running. */
  | { readonly kind: "overdue"; readonly slotStartedAt: Date };

export type ScheduleStatus = {
  readonly name: string;
  readonly everyMs: number;
  readonly jitterMs: number;
  readonly lastEnqueued: EnqueuedSlot | null;
  readonly next: NextRun;
};

/** How long a slot may stay unclaimed before its schedule counts as overdue. */
export const SCHEDULE_GRACE_MS = 2 * SCHEDULER_TICK_MS;

export const scheduleStatus = (schedule: Schedule, lastSlot: number | null, now: Date): ScheduleStatus => {
  const current = scheduleSlot(schedule, now);
  const slotStartedAt = new Date(current * schedule.everyMs);
  const currentRunAt = slotRunAt(schedule, current);
  const next: NextRun =
    lastSlot !== null && lastSlot >= current
      ? {
          kind: "scheduled",
          runAt: currentRunAt > now ? currentRunAt : slotRunAt(schedule, current + 1),
        }
      : now.getTime() - slotStartedAt.getTime() > SCHEDULE_GRACE_MS
        ? { kind: "overdue", slotStartedAt }
        : { kind: "scheduled", runAt: currentRunAt };
  return {
    name: schedule.name,
    everyMs: schedule.everyMs,
    jitterMs: schedule.jitterMs,
    lastEnqueued:
      lastSlot === null
        ? null
        : {
            slotStartedAt: new Date(lastSlot * schedule.everyMs),
            runAt: slotRunAt(schedule, lastSlot),
          },
    next,
  };
};

/** Uses the host clock, as the scheduler does when it picks slots. */
export const readSchedules = async (
  db: JobsDatabase,
  registered: readonly Schedule[],
  now: Date = new Date(),
): Promise<readonly ScheduleStatus[]> => {
  const rows =
    registered.length === 0
      ? []
      : await db
          .select()
          .from(schedules)
          .where(
            inArray(
              schedules.name,
              registered.map((schedule) => schedule.name),
            ),
          );
  const lastSlots = new Map(rows.map((row) => [row.name, row.lastSlot]));
  return registered.map((schedule) => scheduleStatus(schedule, lastSlots.get(schedule.name) ?? null, now));
};
