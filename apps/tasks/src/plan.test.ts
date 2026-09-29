import { describe, expect, test } from "bun:test";
import type { Task } from "./contract";
import { blockers, canDependOn, dateOfDay, dayOfDate, depths, reaches, schedule, topologicalOrder } from "./plan";

const task = (id: string, dependsOn: string[] = [], fields: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: "",
  status: "todo",
  durationDays: 1,
  startOn: null,
  dueOn: null,
  startedAt: null,
  completedAt: null,
  dependsOn,
  ...fields,
});

const MONDAY = dayOfDate("2026-09-21");
const ids = (tasks: readonly Task[]) => tasks.map((t) => t.id);

describe("days", () => {
  test("round-trip through ISO dates", () => {
    expect(dateOfDay(MONDAY)).toBe("2026-09-21");
    expect(dateOfDay(MONDAY + 10)).toBe("2026-10-01");
  });
});

describe("graph", () => {
  //   a ─┬─> c ──> d
  //   b ─┘
  const diamond = [task("d", ["c"]), task("c", ["a", "b"]), task("a"), task("b")];

  test("orders every task after its dependencies, otherwise keeping the given order", () => {
    expect(ids(topologicalOrder(diamond))).toEqual(["a", "b", "c", "d"]);
    expect(ids(topologicalOrder([task("x"), task("y"), task("z")]))).toEqual(["x", "y", "z"]);
  });

  test("ignores dependencies outside the list", () => {
    expect(ids(topologicalOrder([task("c", ["gone"]), task("a")]))).toEqual(["c", "a"]);
  });

  test("refuses a cycle", () => {
    expect(() => topologicalOrder([task("a", ["b"]), task("b", ["a"])])).toThrow("cycle");
  });

  test("follows dependencies transitively", () => {
    expect(reaches(diamond, "d", "a")).toBe(true);
    expect(reaches(diamond, "a", "d")).toBe(false);
    expect(reaches(diamond, "a", "b")).toBe(false);
  });

  test("allows only edges that keep the graph acyclic", () => {
    expect(canDependOn(diamond, "a", "b")).toBe(true);
    expect(canDependOn(diamond, "d", "a")).toBe(true);
    expect(canDependOn(diamond, "a", "d")).toBe(false);
    expect(canDependOn(diamond, "a", "a")).toBe(false);
  });

  test("measures depth by the longest chain of dependencies", () => {
    expect(Object.fromEntries(depths([...diamond, task("e", ["a", "d"])]))).toEqual({ a: 0, b: 0, c: 1, d: 2, e: 3 });
  });

  test("is blocked by unfinished dependencies only", () => {
    const tasks = [task("a", [], { status: "done" }), task("b", [], { status: "doing" }), task("c", ["a", "b"])];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(ids(blockers(task("c", ["a", "b"]), byId))).toEqual(["b"]);
  });
});

describe("schedule", () => {
  test("starts each task once its dependencies finish, and finds the critical path", () => {
    //   a (2d) ──> c (1d)
    //   b (1d) ──┘
    const slots = schedule(
      [task("a", [], { durationDays: 2 }), task("b"), task("c", ["a", "b"], { durationDays: 1 })],
      MONDAY,
    );

    expect(slots.get("a")).toEqual({ start: MONDAY, finish: MONDAY + 2, slack: 0, critical: true });
    expect(slots.get("b")).toEqual({ start: MONDAY, finish: MONDAY + 1, slack: 1, critical: false });
    expect(slots.get("c")).toEqual({ start: MONDAY + 2, finish: MONDAY + 3, slack: 0, critical: true });
  });

  test("waits for a start date", () => {
    const slots = schedule([task("a", [], { startOn: "2026-09-24" })], MONDAY);
    expect(slots.get("a")).toMatchObject({ start: MONDAY + 3, finish: MONDAY + 4 });
  });

  test("places done tasks where they finished, and runs started ones on past their estimate", () => {
    const slots = schedule(
      [
        task("done", [], { status: "done", durationDays: 2, completedAt: "2026-09-18T12:00:00" }),
        task("late", [], { status: "doing", durationDays: 1, startedAt: "2026-09-19T09:00:00" }),
        task("fresh", [], { status: "doing", durationDays: 3, startedAt: "2026-09-21T09:00:00" }),
      ],
      MONDAY,
    );

    expect(slots.get("done")).toMatchObject({ start: MONDAY - 4, finish: MONDAY - 2, critical: false });
    expect(slots.get("late")).toMatchObject({ start: MONDAY - 2, finish: MONDAY + 1 });
    expect(slots.get("fresh")).toMatchObject({ start: MONDAY, finish: MONDAY + 3, critical: true });
  });

  test("gives negative slack along a chain that misses a due date", () => {
    // b is due Tuesday, but a takes until Wednesday.
    const slots = schedule([task("a", [], { durationDays: 3 }), task("b", ["a"], { dueOn: "2026-09-22" })], MONDAY);

    expect(slots.get("b")).toMatchObject({ start: MONDAY + 3, slack: -2, critical: true });
    expect(slots.get("a")).toMatchObject({ slack: -2, critical: true });
  });

  test("leaves a due date comfortably met off the critical path", () => {
    const slots = schedule([task("long", [], { durationDays: 5 }), task("short", [], { dueOn: "2026-09-30" })], MONDAY);
    expect(slots.get("short")).toMatchObject({ slack: 4, critical: false });
  });

  test("ignores the start dates and dependencies of work already begun", () => {
    const slots = schedule(
      [task("a", [], { durationDays: 4 }), task("b", ["a"], { status: "doing", startOn: "2026-10-01" })],
      MONDAY,
    );
    expect(slots.get("b")).toMatchObject({ start: MONDAY, finish: MONDAY + 1 });
  });
});
