import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { z } from "zod";
import { createTestContext } from "../testing";
import { createJobQueue, defineJob, type JobsDatabase, PermanentJobError } from "./queue";
import { defineSchedule, enqueueDueSchedules } from "./schedule";
import { hourlyOutcomes, jobs } from "./schema";
import { readJobQueue, readSchedules, SCHEDULE_GRACE_MS, scheduleStatus } from "./stats";
import { buryAbandonedJobs, drainJobs, OUTCOME_RETENTION_MS, pruneJobOutcomes } from "./worker";

const { sql } = createTestContext();
const db: JobsDatabase = drizzle({ client: sql });
const queue = createJobQueue(sql);

const HOUR = 60 * 60_000;

const namedJob = (handle: () => Promise<void>) =>
  defineJob({
    name: `test.${crypto.randomUUID()}`,
    payload: z.object({}),
    maxAttempts: 3,
    handle,
  });

const statsFor = async (name: string) => {
  const snapshot = await readJobQueue(db, { failureLimit: 1_000 });
  return {
    snapshot,
    stats: snapshot.jobs.find((job) => job.name === name),
    failures: snapshot.recentFailures.filter((failure) => failure.name === name),
  };
};

describe("queue snapshot", () => {
  test("counts pending jobs by what they are waiting on", async () => {
    const job = namedJob(async () => {});
    await queue.enqueue(job, {});
    await queue.enqueue(job, {}, { runAt: new Date(Date.now() + HOUR) });
    await db.insert(jobs).values({
      name: job.name,
      payload: {},
      maxAttempts: 3,
      attempts: 1,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    const { stats } = await statsFor(job.name);

    expect(stats?.queue).toEqual({
      running: 1,
      ready: 1,
      waiting: 1,
      retrying: 0,
      dead: 0,
    });
    expect(stats?.oldestReadyAt?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("records completed jobs, which leave no row behind", async () => {
    const job = namedJob(async () => {});
    await queue.enqueue(job, {});
    await queue.enqueue(job, {});
    await drainJobs(sql, [job]);

    const { stats, snapshot } = await statsFor(job.name);

    expect(stats?.queue.ready).toBe(0);
    expect(stats?.oldestReadyAt).toBeNull();
    expect(stats?.outcomes).toEqual({ completed: 2, retrying: 0, dead: 0 });
    expect(snapshot.hourly).toHaveLength(24);
    expect(snapshot.hourly.at(-1)?.hour.getTime()).toBe(Math.floor(snapshot.observedAt.getTime() / HOUR) * HOUR);
    expect(snapshot.hourly.at(-1)?.completed).toBeGreaterThanOrEqual(2);
  });

  test("lists a retrying failure with its next attempt, and a dead one", async () => {
    const flaky = namedJob(async () => {
      throw new Error("flaky upstream");
    });
    const doomed = namedJob(async () => {
      throw new PermanentJobError("gone for good");
    });
    await queue.enqueue(flaky, {});
    await queue.enqueue(doomed, {});
    await drainJobs(sql, [flaky, doomed]);

    const retrying = await statsFor(flaky.name);
    expect(retrying.stats?.queue).toMatchObject({
      waiting: 1,
      retrying: 1,
      dead: 0,
    });
    expect(retrying.stats?.outcomes).toEqual({
      completed: 0,
      retrying: 1,
      dead: 0,
    });
    expect(retrying.failures).toEqual([
      {
        id: expect.any(String),
        name: flaky.name,
        state: "retrying",
        attempts: 1,
        maxAttempts: 3,
        error: expect.stringContaining("flaky upstream"),
        failedAt: expect.any(Date),
        nextAttemptAt: expect.any(Date),
      },
    ]);

    const dead = await statsFor(doomed.name);
    expect(dead.stats?.queue).toMatchObject({ retrying: 0, dead: 1 });
    expect(dead.failures).toEqual([expect.objectContaining({ state: "dead", attempts: 1 })]);
    expect(dead.failures[0]).not.toHaveProperty("nextAttemptAt");
  });

  test("counts a job buried after its worker died as dead", async () => {
    const job = namedJob(async () => {});
    await db.insert(jobs).values({
      name: job.name,
      payload: {},
      maxAttempts: 1,
      attempts: 1,
      lockedUntil: new Date(Date.now() - 1_000),
    });

    await buryAbandonedJobs(db);

    const { stats, failures } = await statsFor(job.name);
    expect(stats?.outcomes.dead).toBe(1);
    expect(failures).toEqual([expect.objectContaining({ state: "dead", failedAt: expect.any(Date) })]);
  });

  test("prunes outcome counts older than the retention", async () => {
    const name = `test.${crypto.randomUUID()}`;
    const now = new Date();
    await db.insert(hourlyOutcomes).values([
      {
        name,
        hour: new Date(now.getTime() - OUTCOME_RETENTION_MS - HOUR),
        outcome: "completed",
        count: 1,
      },
      {
        name,
        hour: new Date(now.getTime() - HOUR),
        outcome: "completed",
        count: 1,
      },
    ]);

    await pruneJobOutcomes(db, now);

    expect(await db.select().from(hourlyOutcomes).where(eq(hourlyOutcomes.name, name))).toHaveLength(1);
  });
});

describe("schedule status", () => {
  const job = namedJob(async () => {});
  const schedule = defineSchedule({
    name: `test.${crypto.randomUUID()}`,
    everyMs: HOUR,
    job,
    payload: {},
  });
  const slotStart = new Date(Date.UTC(2026, 8, 21, 12));
  const at = (ms: number) => new Date(slotStart.getTime() + ms);

  test("is overdue once the current slot stays unclaimed past the grace period", () => {
    expect(scheduleStatus(schedule, null, at(SCHEDULE_GRACE_MS + 1)).next).toEqual({
      kind: "overdue",
      slotStartedAt: slotStart,
    });
    expect(scheduleStatus(schedule, null, at(1_000)).next).toEqual({
      kind: "scheduled",
      runAt: slotStart,
    });
  });

  test("once the current slot is enqueued, the next run is the following slot", () => {
    const status = scheduleStatus(schedule, slotStart.getTime() / HOUR, at(10 * 60_000));
    expect(status.lastEnqueued).toEqual({
      slotStartedAt: slotStart,
      runAt: slotStart,
    });
    expect(status.next).toEqual({ kind: "scheduled", runAt: at(HOUR) });
  });

  test("reads each registered schedule's last enqueued slot", async () => {
    const now = new Date();
    await enqueueDueSchedules(db, [schedule], now);

    const [status] = await readSchedules(db, [schedule], now);

    expect(status?.lastEnqueued?.slotStartedAt).toEqual(new Date(Math.floor(now.getTime() / HOUR) * HOUR));
    expect(status?.next.kind).toBe("scheduled");
  });
});
