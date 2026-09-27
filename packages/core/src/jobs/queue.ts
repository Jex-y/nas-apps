import type { SQL } from "bun";
import { sql as raw } from "drizzle-orm";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import { z } from "zod";
import { jobs } from "./schema";

export type JobRun = {
  readonly attempt: number;
  /** Aborted when the job exceeds its timeout; handlers must stop work when it fires. */
  readonly signal: AbortSignal;
};

/** A failure that retrying cannot fix, so the job goes straight to `dead`. */
export class PermanentJobError extends Error {}

/** The type-erased view the worker runs; the payload is parsed against the job's schema before its handler sees it. */
export type RegisteredJob = {
  readonly name: string;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly run: (payload: unknown, run: JobRun) => Promise<void>;
};

/** Payload schemas must round-trip through JSON unchanged: no transforms, dates or maps. */
export type JobDefinition<P> = RegisteredJob & { readonly payload: z.ZodType<P> };

/** Must stay above every job's timeout, or a slow job could be reclaimed while still running. */
export const JOB_LEASE_MS = 5 * 60_000;

export const defineJob = <P>(definition: {
  readonly name: string;
  readonly payload: z.ZodType<P>;
  readonly handle: (payload: P, run: JobRun) => Promise<void>;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
}): JobDefinition<P> => {
  const timeoutMs = definition.timeoutMs ?? 60_000;
  if (timeoutMs >= JOB_LEASE_MS - 30_000) {
    throw new Error(`Job "${definition.name}" timeout must leave 30s of its ${JOB_LEASE_MS}ms lease`);
  }
  return {
    name: definition.name,
    payload: definition.payload,
    maxAttempts: definition.maxAttempts ?? 5,
    timeoutMs,
    run: (payload, run) => {
      const parsed = definition.payload.safeParse(payload);
      if (!parsed.success) {
        throw new PermanentJobError(`Invalid payload for ${definition.name}: ${z.prettifyError(parsed.error)}`);
      }
      return definition.handle(parsed.data, run);
    },
  };
};

export type EnqueueOptions = {
  /** While a pending job of the same kind holds this key, enqueueing another with it is a no-op. */
  readonly dedupeKey?: string;
  readonly runAt?: Date;
};

export type JobQueue = {
  /** Resolves `false` when a pending job already holds the dedupe key. */
  readonly enqueue: <P>(job: JobDefinition<P>, payload: P, options?: EnqueueOptions) => Promise<boolean>;
};

export type JobsDatabase = BunSQLDatabase<Record<string, never>>;
/** Anything that can insert jobs: the database itself or a transaction on it. */
export type JobInserter = Pick<JobsDatabase, "insert">;

export const insertJob = async <P>(
  db: JobInserter,
  job: JobDefinition<P>,
  payload: P,
  { dedupeKey, runAt }: EnqueueOptions = {},
): Promise<boolean> => {
  const inserted = await db
    .insert(jobs)
    .values({
      name: job.name,
      payload: job.payload.parse(payload),
      maxAttempts: job.maxAttempts,
      ...(dedupeKey !== undefined && { dedupeKey }),
      ...(runAt !== undefined && { runAt }),
    })
    .onConflictDoNothing({
      target: [jobs.name, jobs.dedupeKey],
      where: raw`${jobs.state} = 'pending' and ${jobs.dedupeKey} is not null`,
    })
    .returning({ id: jobs.id });
  return inserted.length > 0;
};

export const createJobQueue = (sql: SQL): JobQueue => {
  const db: JobsDatabase = drizzle({ client: sql });
  return { enqueue: (job, payload, options) => insertJob(db, job, payload, options) };
};
