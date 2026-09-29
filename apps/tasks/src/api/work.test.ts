import { describe, expect, test } from "bun:test";
import { drainJobs, type Notification } from "@nas/core";
import { createTasksTestContext, NOW, task } from "../../test/support";
import type { ProjectView } from "../contract";
import { tasksDb } from "./db";
import { createTasksService } from "./service";
import { createTasksWork, projectReminder } from "./work";

const context = createTasksTestContext();
const db = tasksDb(context.sql);
const service = createTasksService({ db, now: () => NOW });
const BEFORE_REMINDERS = new Date("2026-09-21T06:30:00Z");

const project = (tasks: ProjectView["tasks"]): ProjectView => ({ id: crypto.randomUUID(), name: "Move house", tasks });

describe("projectReminder", () => {
  test("lists what is overdue, due today and tomorrow, and what the schedule says will be late", () => {
    const view = project([
      task("keys", { title: "Return keys", dueOn: "2026-09-20" }),
      task("deposit", { title: "Pay deposit", dueOn: "2026-09-21" }),
      task("van", { title: "Book van", dueOn: "2026-09-22" }),
      task("pack", { title: "Pack", durationDays: 5 }),
      task("move", { title: "Move in", dueOn: "2026-09-24", dependsOn: ["pack"] }),
      task("meter", { title: "Read meter", dueOn: "2026-09-30" }),
      task("quotes", { title: "Get quotes", dueOn: "2026-09-19", status: "done", completedAt: NOW.toISOString() }),
    ]);

    expect(projectReminder(view, NOW, "https://apps.example")).toEqual({
      title: "Move house",
      message: [
        "Overdue: Return keys",
        "Due today: Pay deposit",
        "Due tomorrow: Book van",
        "Running late: Move in (due 24 September, 2 days late)",
      ].join("\n"),
      clickUrl: `https://apps.example/tasks/${view.id}`,
    });
  });

  test("says nothing when nothing is due soon or slipping", () => {
    expect(projectReminder(project([task("meter", { dueOn: "2026-09-30" }), task("pack")]), NOW, "")).toBeNull();
  });
});

describe("morning reminders", () => {
  const remindAt = async (now: Date) => {
    const sent: Notification[] = [];
    const work = createTasksWork({
      db,
      notifier: { send: async (notification) => void sent.push(notification) },
      publicUrl: "https://apps.example",
      now: () => now,
    });
    await context.jobs.enqueue(work.definitions.remind, {});
    await drainJobs(context.sql, work.jobs);
    return sent;
  };

  test("go out from 8am, once a day per project with something due", async () => {
    const { id } = await service.createProject({ name: "Move house" });
    await service.createTask(id, {
      title: "Pay deposit",
      notes: "",
      durationDays: 1,
      startOn: null,
      dueOn: "2026-09-21",
      dependsOn: [],
    });
    await service.createProject({ name: "Garden" });

    expect(await remindAt(BEFORE_REMINDERS)).toEqual([]);
    expect(await remindAt(NOW)).toEqual([
      { title: "Move house", message: "Due today: Pay deposit", clickUrl: `https://apps.example/tasks/${id}` },
    ]);
    expect(await remindAt(new Date("2026-09-21T15:00:00Z"))).toEqual([]);
    expect(await remindAt(new Date("2026-09-22T08:00:00Z"))).toMatchObject([{ message: "Overdue: Pay deposit" }]);
  });
});
