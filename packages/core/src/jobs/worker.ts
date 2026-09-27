import type { SQL } from "bun";
import { and, type SQL as Expression, eq, inArray, isNull, lt, lte, or, sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { JOB_LEASE_MS, type JobsDatabase, PermanentJobError, type RegisteredJob } from "./queue";
import { enqueueDueSchedules, type Schedule } from "./schedule";
import { jobs } from "./schema";

type ClaimedJob = {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
};

export type JobOutcome = "completed" | "retrying" | "dead";

export const retryDelayMs = (attempt: number): number => Math.min(60 * 60_000, 10_000 * 2 ** (attempt - 1));

/** The database clock unless a test pins one; mixing it with the host clock skews run times by the drift between them. */
const clock = (now: Date | undefined): Date | Expression => now ?? raw`now()`;

const plus = (base: Date | Expression, ms: number): Expression =>
  raw`${base}::timestamptz + ${ms} * interval '1 millisecond'`;

const claimNext = async (
  db: JobsDatabase,
  names: readonly string[],
  now: Date | undefined,
): Promise<ClaimedJob | undefined> => {
  if (names.length === 0) {
    return undefined;
  }
  const candidate = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.state, "pending"),
        inArray(jobs.name, [...names]),
        lte(jobs.runAt, clock(now)),
        or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, clock(now))),
        lt(jobs.attempts, jobs.maxAttempts),
      ),
    )
    .orderBy(jobs.runAt)
    .limit(1)
    .for("update", { skipLocked: true });

  const [claimed] = await db
    .update(jobs)
    .set({
      attempts: raw`${jobs.attempts} + 1`,
      lockedUntil: plus(clock(now), JOB_LEASE_MS),
    })
    .where(inArray(jobs.id, candidate))
    .returning({
      id: jobs.id,
      name: jobs.name,
      payload: jobs.payload,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
    });
  return claimed;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.stack || `${error.name}: ${error.message}` : String(error);

const execute = async (db: JobsDatabase, job: RegisteredJob, claimed: ClaimedJob): Promise<JobOutcome> => {
  const signal = AbortSignal.timeout(job.timeoutMs);
  try {
    await Promise.race([
      job.run(claimed.payload, { attempt: claimed.attempts, signal }),
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
    ]);
    await db.delete(jobs).where(eq(jobs.id, claimed.id));
    return "completed";
  } catch (error) {
    const dead = error instanceof PermanentJobError || claimed.attempts >= claimed.maxAttempts;
    await db
      .update(jobs)
      .set({
        lastError: errorMessage(error),
        lockedUntil: null,
        ...(dead ? { state: "dead" } : { runAt: plus(raw`now()`, retryDelayMs(claimed.attempts)) }),
      })
      .where(eq(jobs.id, claimed.id));
    console.error(`Job ${claimed.name} ${claimed.id} attempt ${claimed.attempts} failed${dead ? " permanently" : ""}`);
    console.error(error);
    return dead ? "dead" : "retrying";
  }
};

/** A worker that died mid-job leaves its lease to lapse; once out of attempts that job can never be claimed again. */
export const buryAbandonedJobs = (db: JobsDatabase, now?: Date) =>
  db
    .update(jobs)
    .set({
      state: "dead",
      lastError: "Lease expired on the final attempt",
      lockedUntil: null,
    })
    .where(
      and(eq(jobs.state, "pending"), lt(jobs.lockedUntil, clock(now)), raw`${jobs.attempts} >= ${jobs.maxAttempts}`),
    );

const registry = (registered: readonly RegisteredJob[]): ReadonlyMap<string, RegisteredJob> => {
  const byName = new Map(registered.map((job) => [job.name, job]));
  if (byName.size !== registered.length) {
    throw new Error("Two registered jobs share a name");
  }
  return byName;
};

/** Claims and runs one due job, if any. */
export const runNextJob = async (
  db: JobsDatabase,
  byName: ReadonlyMap<string, RegisteredJob>,
  now?: Date,
): Promise<JobOutcome | undefined> => {
  const claimed = await claimNext(db, [...byName.keys()], now);
  if (claimed === undefined) {
    return undefined;
  }
  const job = byName.get(claimed.name);
  if (job === undefined) {
    throw new Error(`Claimed unregistered job ${claimed.name}`);
  }
  return execute(db, job, claimed);
};

export type WorkerOptions = {
  readonly sql: SQL;
  readonly jobs: readonly RegisteredJob[];
  readonly schedules: readonly Schedule[];
  readonly concurrency: number;
  readonly signal: AbortSignal;
  /** Called after every loop iteration, for liveness checks. */
  readonly onActivity?: () => void;
};

const IDLE_POLL_MS = 2_000;
const SCHEDULER_TICK_MS = 15_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Runs until `signal` aborts, then waits for in-flight jobs to finish. */
export const runWorker = async ({
  sql,
  jobs: registered,
  schedules,
  concurrency,
  signal,
  onActivity,
}: WorkerOptions): Promise<void> => {
  const db: JobsDatabase = drizzle({ client: sql });
  const byName = registry(registered);

  const lane = async () => {
    while (!signal.aborted) {
      const outcome = await runNextJob(db, byName).catch((error: unknown) => {
        console.error("Worker lane failed to claim a job", error);
        return undefined;
      });
      onActivity?.();
      if (outcome === undefined) {
        await sleep(IDLE_POLL_MS, signal);
      }
    }
  };

  const scheduler = async () => {
    while (!signal.aborted) {
      const now = new Date();
      await Promise.all([enqueueDueSchedules(db, schedules, now), buryAbandonedJobs(db)]).catch((error: unknown) =>
        console.error("Scheduler tick failed", error),
      );
      onActivity?.();
      await sleep(SCHEDULER_TICK_MS, signal);
    }
  };

  await Promise.all([scheduler(), ...Array.from({ length: concurrency }, lane)]);
};

/** Runs due jobs one at a time until none are left; for tests, so a pipeline can be driven deterministically. */
export const drainJobs = async (
  sql: SQL,
  registered: readonly RegisteredJob[],
  now?: Date,
): Promise<Readonly<Record<JobOutcome, number>>> => {
  const db: JobsDatabase = drizzle({ client: sql });
  const byName = registry(registered);
  const counts: Record<JobOutcome, number> = {
    completed: 0,
    retrying: 0,
    dead: 0,
  };
  for (
    let outcome = await runNextJob(db, byName, now);
    outcome !== undefined;
    outcome = await runNextJob(db, byName, now)
  ) {
    counts[outcome] += 1;
  }
  return counts;
};
