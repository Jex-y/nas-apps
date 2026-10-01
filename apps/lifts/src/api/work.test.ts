import { expect, test } from "bun:test";
import { drainJobs } from "@apps/core";
import { uniqueLogin } from "@apps/core/testing";
import { createLiftsTestContext, NOW } from "../../test/support";
import { liftsDb } from "./db";
import { pushes } from "./schema";
import { createLiftsWork, PUSH_MEMORY_MS } from "./work";

const context = createLiftsTestContext();
const db = liftsDb(context.sql);

test("forgets pushes once no device could still be retrying them", async () => {
  const owner = uniqueLogin();
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  await db.insert(pushes).values([
    { owner, key: "old", appliedAt: ago(PUSH_MEMORY_MS + 1000) },
    { owner, key: "recent", appliedAt: ago(PUSH_MEMORY_MS - 1000) },
  ]);
  const work = createLiftsWork({ db, now: () => NOW });

  await context.jobs.enqueue(work.definitions.forgetPushes, {});
  await drainJobs(context.sql, work.jobs);

  expect((await db.select({ key: pushes.key }).from(pushes)).map((push) => push.key)).toEqual(["recent"]);
});
