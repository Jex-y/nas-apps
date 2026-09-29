import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { z } from "zod";
import { createTestContext } from "../testing";
import { createJobQueue, defineJob, type JobDefinition, type JobsDatabase, PermanentJobError } from "./queue";
import { defineSchedule, enqueueDueSchedules, slotRunAt } from "./schedule";
import { jobs } from "./schema";
import { buryAbandonedJobs, drainJobs, retryDelayMs } from "./worker";

const { sql } = createTestContext();
const db: JobsDatabase = drizzle({ client: sql });
const queue = createJobQueue(sql);

const uniqueName = () => `test.${crypto.randomUUID()}`;

const recordingJob = (options: { maxAttempts?: number; fail?: (attempt: number) => Error | undefined } = {}) => {
  const seen: { value: number; attempt: number }[] = [];
  const job = defineJob({
    name: uniqueName(),
    payload: z.object({ value: z.number() }),
    maxAttempts: options.maxAttempts ?? 3,
    handle: async ({ value }, { attempt }) => {
      seen.push({ value, attempt });
      const error = options.fail?.(attempt);
      if (error !== undefined) {
        throw error;
      }
    },
  });
  return { job, seen };
};

const rowsFor = (job: JobDefinition<unknown>) => db.select().from(jobs).where(eq(jobs.name, job.name));

const later = (ms: number) => new Date(Date.now() + ms);

describe("job queue", () => {
  test("runs an enqueued job with its payload, then removes it", async () => {
    const { job, seen } = recordingJob();
    expect(await queue.enqueue(job, { value: 7 })).toBe(true);

    expect(await drainJobs(sql, [job])).toEqual({ completed: 1, retrying: 0, dead: 0 });
    expect(seen).toEqual([{ value: 7, attempt: 1 }]);
    expect(await rowsFor(job)).toEqual([]);
  });

  test("skips a duplicate while the first is pending, and accepts it again once done", async () => {
    const { job, seen } = recordingJob();
    expect(await queue.enqueue(job, { value: 1 }, { dedupeKey: "listing:1" })).toBe(true);
    expect(await queue.enqueue(job, { value: 2 }, { dedupeKey: "listing:1" })).toBe(false);

    await drainJobs(sql, [job]);
    expect(await queue.enqueue(job, { value: 3 }, { dedupeKey: "listing:1" })).toBe(true);
    await drainJobs(sql, [job]);

    expect(seen.map((run) => run.value)).toEqual([1, 3]);
  });

  test("does not run a job before its run time", async () => {
    const { job, seen } = recordingJob();
    await queue.enqueue(job, { value: 1 }, { runAt: later(60_000) });

    await drainJobs(sql, [job]);
    expect(seen).toEqual([]);

    await drainJobs(sql, [job], later(61_000));
    expect(seen).toHaveLength(1);
  });

  test("rejects a payload that does not match the schema at enqueue time", async () => {
    const { job } = recordingJob();
    expect(queue.enqueue(job, { value: "nope" } as unknown as { value: number })).rejects.toThrow();
  });

  test("claims one job at a time, leaving the rest free for other workers", async () => {
    const name = uniqueName();
    const leasedWhileRunning: number[] = [];
    const job = defineJob({
      name,
      payload: z.object({ value: z.number() }),
      handle: async () => {
        const leased = await db.select().from(jobs).where(eq(jobs.name, name));
        leasedWhileRunning.push(leased.filter((row) => row.lockedUntil !== null).length);
      },
    });
    for (const value of [1, 2, 3, 4, 5]) {
      await queue.enqueue(job, { value });
    }

    expect(await drainJobs(sql, [job])).toEqual({ completed: 5, retrying: 0, dead: 0 });
    expect(leasedWhileRunning).toEqual([1, 1, 1, 1, 1]);
  });

  test("two concurrent workers never run the same job", async () => {
    const { job, seen } = recordingJob();
    await Promise.all(Array.from({ length: 30 }, (_, value) => queue.enqueue(job, { value })));

    await Promise.all([drainJobs(sql, [job]), drainJobs(sql, [job]), drainJobs(sql, [job])]);

    expect(seen.map((run) => run.value).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });
});

describe("failures", () => {
  test("retries with backoff, then succeeds", async () => {
    const { job, seen } = recordingJob({ fail: (attempt) => (attempt === 1 ? new Error("flaky") : undefined) });
    await queue.enqueue(job, { value: 1 });

    expect(await drainJobs(sql, [job])).toEqual({ completed: 0, retrying: 1, dead: 0 });
    const [waiting] = await rowsFor(job);
    expect(waiting?.lastError).toContain("flaky");
    expect(waiting?.runAt.getTime()).toBeGreaterThan(Date.now() + retryDelayMs(1) - 5_000);

    expect(await drainJobs(sql, [job], later(retryDelayMs(1) + 1_000))).toEqual({
      completed: 1,
      retrying: 0,
      dead: 0,
    });
    expect(seen.map((run) => run.attempt)).toEqual([1, 2]);
  });

  test("buries a job once it runs out of attempts", async () => {
    const { job } = recordingJob({ maxAttempts: 2, fail: () => new Error("always") });
    await queue.enqueue(job, { value: 1 });

    await drainJobs(sql, [job]);
    expect(await drainJobs(sql, [job], later(retryDelayMs(1) + 1_000))).toEqual({
      completed: 0,
      retrying: 0,
      dead: 1,
    });
    const [dead] = await rowsFor(job);
    expect(dead?.state).toBe("dead");
    expect(dead?.attempts).toBe(2);
  });

  test("buries a permanent failure without retrying", async () => {
    const { job, seen } = recordingJob({ fail: () => new PermanentJobError("gone") });
    await queue.enqueue(job, { value: 1 });

    expect(await drainJobs(sql, [job])).toEqual({ completed: 0, retrying: 0, dead: 1 });
    expect(seen).toHaveLength(1);
  });

  test("buries a stored payload that no longer matches the schema", async () => {
    const { job, seen } = recordingJob();
    await db.insert(jobs).values({ name: job.name, payload: { value: "stale" }, maxAttempts: 3 });

    expect(await drainJobs(sql, [job])).toEqual({ completed: 0, retrying: 0, dead: 1 });
    expect(seen).toEqual([]);
  });

  test("fails a job that outlives its timeout", async () => {
    const job = defineJob({
      name: uniqueName(),
      payload: z.object({}),
      timeoutMs: 50,
      handle: () => new Promise(() => {}),
    });
    await queue.enqueue(job, {});

    expect(await drainJobs(sql, [job])).toEqual({ completed: 0, retrying: 1, dead: 0 });
    const [row] = await rowsFor(job);
    expect(row?.lastError).toContain("TimeoutError");
  });

  test("reclaims a job whose worker died, and buries it if that was its last attempt", async () => {
    const { job, seen } = recordingJob({ maxAttempts: 2 });
    const expired = new Date(Date.now() - 1_000);
    await db.insert(jobs).values([
      { name: job.name, payload: { value: 1 }, maxAttempts: 2, attempts: 1, lockedUntil: expired },
      { name: job.name, payload: { value: 2 }, maxAttempts: 2, attempts: 2, lockedUntil: expired },
    ]);

    await buryAbandonedJobs(db, new Date());
    await drainJobs(sql, [job]);

    expect(seen).toEqual([{ value: 1, attempt: 2 }]);
    const remaining = await rowsFor(job);
    expect(remaining.map((row) => [row.state, row.lastError])).toEqual([
      ["dead", "Lease expired on the final attempt"],
    ]);
  });
});

describe("schedules", () => {
  const everyMs = 10 * 60_000;

  test("enqueues each slot exactly once, jittered inside the slot", async () => {
    const { job, seen } = recordingJob();
    const schedule = defineSchedule({ name: uniqueName(), everyMs, jitterMs: 3 * 60_000, job, payload: { value: 1 } });
    const slotStart = new Date(Math.floor(Date.now() / everyMs) * everyMs);

    expect(await enqueueDueSchedules(db, [schedule], slotStart)).toEqual([schedule.name]);
    expect(await enqueueDueSchedules(db, [schedule], new Date(slotStart.getTime() + 60_000))).toEqual([]);

    const [queued] = await rowsFor(job);
    const runAt = queued?.runAt.getTime() ?? 0;
    expect(runAt).toBeGreaterThanOrEqual(slotStart.getTime());
    expect(runAt).toBeLessThan(slotStart.getTime() + 3 * 60_000);
    expect(runAt).toBe(slotRunAt(schedule, slotStart.getTime() / everyMs).getTime());

    const nextSlot = new Date(slotStart.getTime() + everyMs);
    expect(await enqueueDueSchedules(db, [schedule], nextSlot)).toEqual([schedule.name]);
    await drainJobs(sql, [job], new Date(nextSlot.getTime() + everyMs));
    expect(seen).toHaveLength(2);
  });

  test("concurrent schedulers enqueue a slot once between them", async () => {
    const { job } = recordingJob();
    const schedule = defineSchedule({ name: uniqueName(), everyMs, job, payload: { value: 1 } });
    const now = new Date();

    const results = await Promise.all([
      enqueueDueSchedules(db, [schedule], now),
      enqueueDueSchedules(db, [schedule], now),
      enqueueDueSchedules(db, [schedule], now),
    ]);

    expect(results.flat()).toEqual([schedule.name]);
    expect(await rowsFor(job)).toHaveLength(1);
  });
});

test("stores payloads as JSON documents Postgres can query", async () => {
  const { job } = recordingJob();
  await queue.enqueue(job, { value: 7 });

  const [row] =
    await sql`select jsonb_typeof(payload) as type, payload->>'value' as value from jobs.jobs where name = ${job.name}`;
  expect(row).toEqual({ type: "object", value: "7" });
});
