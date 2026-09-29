import { describe, expect, test } from "bun:test";
import { drainJobs, type Notification } from "@apps/core";
import { uniqueLogin } from "@apps/core/testing";
import { createTasksTestContext, NOW, task } from "../../test/support";
import { tasksDb } from "./db";
import { createTasksService } from "./service";
import { createTasksWork, reminderFor } from "./work";

const context = createTasksTestContext();
const db = tasksDb(context.sql);
const service = createTasksService({ db, now: () => NOW });
const BEFORE_REMINDERS = new Date("2026-09-21T06:30:00Z");

describe("reminderFor", () => {
  test("lists what is overdue, due today and tomorrow, and what the schedule says will be late", () => {
    const list = [
      task("keys", { title: "Return keys", dueOn: "2026-09-20" }),
      task("deposit", { title: "Pay deposit", dueOn: "2026-09-21" }),
      task("van", { title: "Book van", dueOn: "2026-09-22" }),
      task("pack", { title: "Pack", durationDays: 5 }),
      task("move", { title: "Move in", dueOn: "2026-09-24", dependsOn: ["pack"] }),
      task("meter", { title: "Read meter", dueOn: "2026-09-30" }),
      task("quotes", { title: "Get quotes", dueOn: "2026-09-19", status: "done", completedAt: NOW.toISOString() }),
    ];

    expect(reminderFor(list, NOW, "https://apps.example")).toEqual({
      title: "Tasks",
      message: [
        "Overdue: Return keys",
        "Due today: Pay deposit",
        "Due tomorrow: Book van",
        "Running late: Move in (due 24 September, 2 days late)",
      ].join("\n"),
      clickUrl: "https://apps.example/tasks/",
    });
  });

  test("says nothing when nothing is due soon or slipping", () => {
    expect(reminderFor([task("meter", { dueOn: "2026-09-30" }), task("pack")], NOW, "")).toBeNull();
  });
});

describe("morning reminders", () => {
  const due = (dueOn: string | null) => ({
    title: "Pay deposit",
    notes: "",
    durationDays: 1,
    startOn: null,
    dueOn,
    dependsOn: [],
  });

  const remindAt = async (now: Date) => {
    const sent: { owner: string; notification: Notification }[] = [];
    const work = createTasksWork({
      db,
      notifier: (owner) => ({ send: async (notification) => void sent.push({ owner, notification }) }),
      publicUrl: "https://apps.example",
      now: () => now,
    });
    await context.jobs.enqueue(work.definitions.remind, {});
    await drainJobs(context.sql, work.jobs);
    return sent;
  };

  test("go out from 8am, once a day, only to whoever has something due", async () => {
    const me = uniqueLogin();
    await service.createTask(me, due("2026-09-21"));
    await service.createTask(uniqueLogin(), due(null));

    expect(await remindAt(BEFORE_REMINDERS)).toEqual([]);
    expect(await remindAt(NOW)).toEqual([
      {
        owner: me,
        notification: { title: "Tasks", message: "Due today: Pay deposit", clickUrl: "https://apps.example/tasks/" },
      },
    ]);
    expect(await remindAt(new Date("2026-09-21T15:00:00Z"))).toEqual([]);
    expect(await remindAt(new Date("2026-09-22T08:00:00Z"))).toMatchObject([
      { owner: me, notification: { message: "Overdue: Pay deposit" } },
    ]);
  });
});
