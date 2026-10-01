import { defineJob, defineSchedule, type RegisteredJob, type Schedule } from "@apps/core";
import { lt } from "drizzle-orm";
import { z } from "zod";
import type { LiftsDb } from "./db";
import { pushes } from "./schema";

export type LiftsWorkDeps = {
  readonly db: LiftsDb;
  readonly now: () => Date;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How long a push is remembered. A device retries one within minutes of the answer it lost, never weeks. */
export const PUSH_MEMORY_MS = 30 * DAY;

export const createLiftsWork = ({ db, now }: LiftsWorkDeps) => {
  const forgetPushes = defineJob({
    name: "lifts.forget-pushes",
    payload: z.object({}),
    handle: async () => {
      await db.delete(pushes).where(lt(pushes.appliedAt, new Date(now().getTime() - PUSH_MEMORY_MS)));
    },
  });

  const jobs: readonly RegisteredJob[] = [forgetPushes];

  const schedules: readonly Schedule[] = [
    defineSchedule({ name: "lifts.forget-pushes", everyMs: DAY, jitterMs: HOUR, job: forgetPushes, payload: {} }),
  ];

  return { jobs, schedules, definitions: { forgetPushes } };
};
