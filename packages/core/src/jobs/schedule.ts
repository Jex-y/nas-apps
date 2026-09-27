import { lt } from "drizzle-orm";
import { insertJob, type JobDefinition, type JobInserter, type JobsDatabase } from "./queue";
import { schedules } from "./schema";

/** Enqueues one job per `everyMs` slot, offset by a stable per-slot jitter so polling does not look clockwork. */
export type Schedule = {
  readonly name: string;
  readonly everyMs: number;
  readonly jitterMs: number;
  readonly enqueue: (db: JobInserter, slot: number, runAt: Date) => Promise<void>;
};

export const defineSchedule = <P>(definition: {
  readonly name: string;
  readonly everyMs: number;
  readonly jitterMs?: number;
  readonly job: JobDefinition<P>;
  readonly payload: P;
}): Schedule => {
  const jitterMs = definition.jitterMs ?? 0;
  if (jitterMs >= definition.everyMs) {
    throw new Error(`Schedule "${definition.name}" jitter must be shorter than its interval`);
  }
  return {
    name: definition.name,
    everyMs: definition.everyMs,
    jitterMs,
    enqueue: async (db, slot, runAt) => {
      await insertJob(db, definition.job, definition.payload, {
        dedupeKey: `schedule:${definition.name}:${slot}`,
        runAt,
      });
    },
  };
};

export const scheduleSlot = (schedule: Schedule, now: Date): number => Math.floor(now.getTime() / schedule.everyMs);

export const slotRunAt = (schedule: Schedule, slot: number): Date => {
  const jitter = schedule.jitterMs === 0 ? 0 : Number(BigInt(Bun.hash(`:`)) % BigInt(schedule.jitterMs));
  return new Date(slot * schedule.everyMs + jitter);
};

/** Enqueues the current slot of every schedule that has not enqueued it yet; returns the names that did. */
export const enqueueDueSchedules = async (
  db: JobsDatabase,
  due: readonly Schedule[],
  now: Date,
): Promise<readonly string[]> => {
  const enqueued: string[] = [];
  for (const schedule of due) {
    const slot = scheduleSlot(schedule, now);
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(schedules)
        .values({ name: schedule.name, lastSlot: slot })
        .onConflictDoUpdate({ target: schedules.name, set: { lastSlot: slot }, setWhere: lt(schedules.lastSlot, slot) })
        .returning({ name: schedules.name });
      if (rows.length > 0) {
        await schedule.enqueue(tx, slot, slotRunAt(schedule, slot));
      }
      return rows.length > 0;
    });
    if (claimed) {
      enqueued.push(schedule.name);
    }
  }
  return enqueued;
};
