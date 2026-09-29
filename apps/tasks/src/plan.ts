import type { Task } from "./contract";

/**
 * The dependency graph and the schedule it implies, shared by the server (cycle checks) and the UI (the list, the
 * board's blocked badges and the timeline). Pure, so both agree and tests need no database.
 */

type Node = Pick<Task, "id" | "dependsOn">;

const DAY_MS = 86_400_000;

/** Days since the Unix epoch, the unit every schedule is in. */
export type Day = number;

export const dayOfDate = (date: string): Day => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** The local calendar day of an instant, in the runtime's time zone. */
export const dayOfInstant = (instant: Date | string): Day => {
  const at = new Date(instant);
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / DAY_MS;
};

export const dateOfDay = (day: Day): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Whether following dependencies from `from` ever arrives at `to`, i.e. `from` cannot start before `to` is done. */
export const reaches = (tasks: readonly Node[], from: string, to: string): boolean => {
  const dependsOn = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  const seen = new Set<string>();
  const pending = [from];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === to) {
      return true;
    }
    if (!seen.has(id)) {
      seen.add(id);
      pending.push(...(dependsOn.get(id) ?? []));
    }
  }
  return false;
};

/** Whether `task` may take `dependsOnId` as a dependency without closing a cycle. */
export const canDependOn = (tasks: readonly Node[], taskId: string, dependsOnId: string): boolean =>
  taskId !== dependsOnId && !reaches(tasks, dependsOnId, taskId);

/**
 * Every task after everything it depends on (Kahn's algorithm), otherwise keeping the given order. Dependencies on
 * tasks outside the list are ignored. Throws on a cycle, which the database never holds.
 */
export const topologicalOrder = <T extends Node>(tasks: readonly T[]): T[] => {
  const ids = new Set(tasks.map((task) => task.id));
  const waitingOn = new Map(tasks.map((task) => [task.id, task.dependsOn.filter((id) => ids.has(id)).length]));
  const dependents = new Map<string, T[]>();
  for (const task of tasks) {
    for (const id of task.dependsOn) {
      dependents.set(id, [...(dependents.get(id) ?? []), task]);
    }
  }

  const order = tasks.filter((task) => waitingOn.get(task.id) === 0);
  for (let index = 0; index < order.length; index++) {
    for (const dependent of dependents.get(order[index]?.id ?? "") ?? []) {
      const left = (waitingOn.get(dependent.id) ?? 0) - 1;
      waitingOn.set(dependent.id, left);
      if (left === 0) {
        order.push(dependent);
      }
    }
  }
  if (order.length !== tasks.length) {
    throw new Error("Dependencies form a cycle");
  }
  return order;
};

/** How many tasks deep each one sits: 0 with no dependencies, else one more than its deepest dependency. */
export const depths = (tasks: readonly Node[]): Map<string, number> => {
  const depth = new Map<string, number>();
  for (const task of topologicalOrder(tasks)) {
    depth.set(task.id, Math.max(-1, ...task.dependsOn.map((id) => depth.get(id) ?? -1)) + 1);
  }
  return depth;
};

/** The unfinished tasks `task` waits on. */
export const blockers = <T extends Pick<Task, "id" | "status">>(task: Node, byId: ReadonlyMap<string, T>): T[] =>
  task.dependsOn.flatMap((id) => byId.get(id) ?? []).filter((dependency) => dependency.status !== "done");

export type Slot = {
  /** First day of work. */
  readonly start: Day;
  /** The day after the last day of work. */
  readonly finish: Day;
  /** Days the task can slip before it delays the project or misses a due date; negative when already late. */
  readonly slack: number;
  /** Unfinished and without slack: any slip delays the project or a due date. */
  readonly critical: boolean;
};

type Scheduled = Node & Pick<Task, "status" | "durationDays" | "startOn" | "dueOn" | "startedAt" | "completedAt">;

/**
 * The critical-path schedule from `today`. Done tasks sit where they finished and started tasks where they began,
 * running on past their estimate until done; the rest start as soon as their dependencies and start dates allow.
 * A backward pass from the project's end and each due date then gives every task its slack.
 */
export const schedule = (tasks: readonly Scheduled[], today: Day): Map<string, Slot> => {
  const order = topologicalOrder(tasks);
  const earliest = new Map<string, { start: Day; finish: Day }>();

  for (const task of order) {
    if (task.status === "done") {
      const finish = task.completedAt === null ? today : dayOfInstant(task.completedAt) + 1;
      earliest.set(task.id, { start: finish - task.durationDays, finish });
    } else if (task.status === "doing") {
      const start = task.startedAt === null ? today : dayOfInstant(task.startedAt);
      earliest.set(task.id, { start, finish: Math.max(start + task.durationDays, today + 1) });
    } else {
      const start = Math.max(
        today,
        task.startOn === null ? today : dayOfDate(task.startOn),
        ...task.dependsOn.map((id) => earliest.get(id)?.finish ?? today),
      );
      earliest.set(task.id, { start, finish: start + task.durationDays });
    }
  }

  const end = Math.max(today, ...[...earliest.values()].map((slot) => slot.finish));
  const latestFinish = new Map<string, Day>();
  const slots = new Map<string, Slot>();
  for (const task of order.toReversed()) {
    const { start, finish } = earliest.get(task.id) ?? { start: today, finish: today };
    const due = task.dueOn === null ? end : dayOfDate(task.dueOn) + 1;
    // Reverse topological order has already visited every dependent, so this is final.
    const latest = Math.min(end, due, latestFinish.get(task.id) ?? end);
    // Only work not yet begun can move, so only it constrains what it depends on.
    if (task.status === "todo") {
      for (const id of task.dependsOn) {
        latestFinish.set(id, Math.min(latestFinish.get(id) ?? end, latest - task.durationDays));
      }
    }
    const slack = latest - finish;
    slots.set(task.id, { start, finish, slack, critical: task.status !== "done" && slack <= 0 });
  }
  return slots;
};
