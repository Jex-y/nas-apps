import { beforeEach } from "bun:test";
import { createTestContext } from "@apps/core/testing";
import type { Task } from "../src/contract";

/** 09:30 on a British Summer Time Monday, after the morning reminders start. */
export const NOW = new Date("2026-09-21T08:30:00Z");

/** The test database, with the tasks tables and tasks jobs emptied before each test. Call once per test file. */
export const createTasksTestContext = () => {
  const context = createTestContext();
  beforeEach(async () => {
    await context.sql`truncate tasks.tasks, tasks.reminders cascade`;
    await context.sql`delete from jobs.jobs where name like 'tasks.%'`;
  });
  return context;
};

export const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: "",
  status: "todo",
  durationDays: 1,
  startOn: null,
  dueOn: null,
  startedAt: null,
  completedAt: null,
  dependsOn: [],
  ...fields,
});
