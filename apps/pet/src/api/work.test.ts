import { describe, expect, test } from "bun:test";
import { uniqueLogin } from "@nas/core/testing";
import { eq } from "drizzle-orm";
import { createPetTestbed } from "../../test/support";
import { nudges } from "./schema";

const { context, db, setup, hatch, walk } = createPetTestbed();

const HATCHED = new Date("2026-09-14T08:00:00Z");
/** 18:30 on a British Summer Time Monday. */
const EVENING = new Date("2026-09-21T17:30:00Z");
const AFTERNOON = new Date("2026-09-21T14:00:00Z");

const nudgeFor = async (login: string, now: Date) => {
  const { work, sent, drain } = setup(now);
  await work.checkNudges(login);
  await drain();
  return sent;
};

describe("evening nudge", () => {
  test("tells only the owner how far there is to go, once a day", async () => {
    const me = uniqueLogin();
    await hatch(me, HATCHED);
    await hatch(uniqueLogin(), HATCHED);
    await walk(
      me,
      [
        { date: "2026-09-20", steps: 9_000 },
        { date: "2026-09-21", steps: 4_800 },
      ],
      AFTERNOON,
    );

    expect(await nudgeFor(me, EVENING)).toEqual([
      {
        login: me,
        notification: {
          title: "Pip",
          message: "Pip is peckish: 3,200 steps to go",
          clickUrl: "https://apps.example/pet/",
        },
      },
    ]);
    expect(await nudgeFor(me, new Date("2026-09-21T19:00:00Z"))).toEqual([]);
  });

  test("waits for the evening", async () => {
    const me = uniqueLogin();
    await hatch(me, HATCHED);
    await walk(me, [{ date: "2026-09-21", steps: 1_000 }], AFTERNOON);

    expect(await nudgeFor(me, new Date("2026-09-21T16:45:00Z"))).toEqual([]);
  });

  test("says how far it is to bring a runaway home", async () => {
    const me = uniqueLogin();
    await hatch(me, new Date("2026-09-13T08:00:00Z"));
    await walk(me, [{ date: "2026-09-21", steps: 2_000 }], AFTERNOON);

    const [sent] = await nudgeFor(me, EVENING);
    expect(sent?.notification.message).toBe("Pip is still out there: 10,000 more steps today would bring them home");
  });
});

describe("goal celebration", () => {
  test("goes out as soon as the goal is hit, and only once", async () => {
    const me = uniqueLogin();
    await hatch(me, HATCHED);
    await walk(
      me,
      [
        { date: "2026-09-20", steps: 9_000 },
        { date: "2026-09-21", steps: 8_400 },
      ],
      AFTERNOON,
    );

    expect(await nudgeFor(me, AFTERNOON)).toEqual([
      {
        login: me,
        notification: {
          title: "Pip is full",
          message: "Goal reached with 8,400 steps: 2 days in a row.",
          clickUrl: "https://apps.example/pet/",
        },
      },
    ]);
    expect(await nudgeFor(me, EVENING)).toEqual([]);
  });
});

describe("stale data warning", () => {
  test("warns once when Health has been quiet too long, but not at night", async () => {
    const me = uniqueLogin();
    await hatch(me, HATCHED);
    await walk(me, [{ date: "2026-09-19", steps: 9_000 }], new Date("2026-09-19T12:00:00Z"));

    expect(await nudgeFor(me, new Date("2026-09-21T05:30:00Z"))).toEqual([]);
    const [warning] = await nudgeFor(me, EVENING);
    expect(warning?.notification).toMatchObject({
      title: "No steps from Apple Health",
      clickUrl: "https://apps.example/pet/health",
    });
    expect(warning?.notification.message).toContain("Sat 13:00");
    expect(await nudgeFor(me, new Date("2026-09-21T19:00:00Z"))).toEqual([]);
  });

  test("tolerates a day without data, as when the phone stays locked", async () => {
    const me = uniqueLogin();
    await hatch(me, HATCHED);
    await walk(me, [{ date: "2026-09-20", steps: 9_000 }], new Date("2026-09-20T08:00:00Z"));

    const sent = await nudgeFor(me, EVENING);
    expect(sent.map(({ notification }) => notification.title)).toEqual(["Pip"]);
  });
});

describe("sweep", () => {
  test("checks every pet and reaches each owner separately", async () => {
    const [ed, sam] = [uniqueLogin(), uniqueLogin()];
    for (const login of [ed, sam]) {
      await hatch(login, HATCHED);
      await walk(login, [{ date: "2026-09-21", steps: 8_000 }], AFTERNOON);
    }
    const { work, sent, drain } = setup(AFTERNOON);

    await work.definitions.sweepNudges.run({}, { attempt: 1, signal: new AbortController().signal });
    await drain();

    expect(sent.map(({ login }) => login).toSorted()).toEqual([ed, sam].toSorted());
  });
});

describe("delivery", () => {
  test("a failed send is not recorded, so the retry sends it", async () => {
    const me = uniqueLogin();
    const pet = await hatch(me, HATCHED);
    await walk(me, [{ date: "2026-09-21", steps: 8_000 }], AFTERNOON);
    const failing = setup(AFTERNOON, async () => {
      throw new Error("push service down");
    });

    await failing.work.checkNudges(me);
    expect(await failing.drain()).toMatchObject({ retrying: 1 });
    expect(await db.select().from(nudges).where(eq(nudges.petId, pet.id))).toEqual([]);

    await context.sql`update jobs.jobs set run_at = now() where name = 'pet.nudge'`;
    const { sent, drain } = setup(AFTERNOON);
    await drain();
    expect(sent).toHaveLength(1);
    expect(await db.select({ kind: nudges.kind }).from(nudges).where(eq(nudges.petId, pet.id))).toEqual([
      { kind: "goal" },
    ]);
  });
});
