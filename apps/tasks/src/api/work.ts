import {
  defineJob,
  defineSchedule,
  type Notification,
  type Notifier,
  type RegisteredJob,
  type Schedule,
} from "@nas/core";
import { z } from "zod";
import type { ProjectView } from "../contract";
import { dateOfDay, dayOfDate, schedule } from "../plan";
import { londonDate, londonDay, londonHour } from "./calendar";
import type { TasksDb } from "./db";
import { projects, reminders } from "./schema";
import { readProjectView } from "./views";

export type TasksWorkDeps = {
  readonly db: TasksDb;
  /** Reaches everyone: projects are shared across the tailnet. */
  readonly notifier: Notifier;
  readonly publicUrl: string;
  readonly now: () => Date;
};

const MINUTE = 60_000;

/** London hour from which each project's reminder goes out. */
export const REMINDER_HOUR = 8;

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
const list = (titles: readonly string[]) => titles.join(", ");

/**
 * This morning's reminder for a project: what is overdue, due today or tomorrow, and what the schedule says will
 * miss its due date further out. `null` when nothing needs saying.
 */
export const projectReminder = (view: ProjectView, now: Date, publicUrl: string): Notification | null => {
  const today = londonDay(now);
  const slots = schedule(view.tasks, today, londonDay);
  const dated = view.tasks.flatMap((task) =>
    task.status === "done" || task.dueOn === null ? [] : [{ task, due: dayOfDate(task.dueOn) }],
  );
  const titlesWhere = (test: (due: number) => boolean) =>
    dated.filter(({ due }) => test(due)).map(({ task }) => task.title);

  const late = dated.flatMap(({ task, due }) => {
    const overrun = (slots.get(task.id)?.finish ?? today) - (due + 1);
    return due > today + 1 && overrun > 0
      ? [`${task.title} (due ${dayMonth.format(new Date(dateOfDay(due)))}, ${days(overrun)} late)`]
      : [];
  });
  const lines = [
    ["Overdue", titlesWhere((due) => due < today)],
    ["Due today", titlesWhere((due) => due === today)],
    ["Due tomorrow", titlesWhere((due) => due === today + 1)],
    ["Running late", late],
  ] as const;

  const message = lines
    .filter(([, titles]) => titles.length > 0)
    .map(([label, titles]) => `${label}: ${list(titles)}`)
    .join("\n");
  return message === "" ? null : { title: view.name, message, clickUrl: `${publicUrl}/tasks/${view.id}` };
};

export const createTasksWork = ({ db, notifier, publicUrl, now }: TasksWorkDeps) => {
  /** Each reminder is claimed and sent in one transaction, so a failed send is retried rather than lost or repeated. */
  const remind = defineJob({
    name: "tasks.remind",
    payload: z.object({}),
    handle: async () => {
      const at = now();
      if (londonHour(at) < REMINDER_HOUR) {
        return;
      }
      for (const { id } of await db.select({ id: projects.id }).from(projects)) {
        const notification = projectReminder(await readProjectView(db, id), at, publicUrl);
        if (notification === null) {
          continue;
        }
        await db.transaction(async (tx) => {
          const claimed = await tx
            .insert(reminders)
            .values({ projectId: id, date: londonDate(at) })
            .onConflictDoNothing()
            .returning({ projectId: reminders.projectId });
          if (claimed.length > 0) {
            await notifier.send(notification);
          }
        });
      }
    },
  });

  const jobs: readonly RegisteredJob[] = [remind];

  const schedules: readonly Schedule[] = [
    defineSchedule({ name: "tasks.remind", everyMs: 15 * MINUTE, jitterMs: MINUTE, job: remind, payload: {} }),
  ];

  return { jobs, schedules, definitions: { remind } };
};
