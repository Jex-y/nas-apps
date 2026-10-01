import { describe, expect, test } from "bun:test";
import type { LiftSet } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { lastSession, nextSet } from "./prefill";

const SQUAT = { id: "squat", name: "Squat", lift: null };

const set = (weightKg: number, reps: number, kind: LiftSet["kind"] = "work"): LiftSet => ({
  id: `${weightKg}x${reps}`,
  entryId: "entry",
  position: 0,
  weightKg,
  reps,
  rpe: 8,
  kind,
  loggedAt: "2026-10-01T18:00:00.000Z",
});

const workout = (id: string, date: string, sets: LiftSet[]): WorkoutDetail => ({
  id,
  date,
  finishedAt: null,
  notes: "",
  bodyweightKg: null,
  entries: [{ id: `${id}-squat`, workoutId: id, exerciseId: SQUAT.id, position: 0, notes: "", exercise: SQUAT, sets }],
});

const history = [
  workout("a", "2026-09-17", [set(130, 5)]),
  workout("b", "2026-09-24", [set(60, 5, "warmup"), set(135, 5), set(140, 3)]),
  workout("c", "2026-10-01", []),
  workout("d", "2026-10-08", [set(150, 1)]),
];

describe("lastSession", () => {
  test("finds the latest earlier workout that trained the exercise", () => {
    expect(lastSession(history, { id: "c", date: "2026-10-01" }, SQUAT.id)?.workout.id).toBe("b");
    expect(lastSession(history, { id: "a", date: "2026-09-17" }, SQUAT.id)).toBeNull();
    expect(lastSession(history, { id: "c", date: "2026-10-01" }, "bench")).toBeNull();
  });
});

describe("nextSet", () => {
  test("opens with last session's first work set, without its RPE", () => {
    const lastTime = lastSession(history, { id: "c", date: "2026-10-01" }, SQUAT.id);

    expect(nextSet({ sets: [] }, lastTime)).toEqual({ weightKg: 135, reps: 5, rpe: null, kind: "work" });
  });

  test("repeats the set before it, counting a miss as a single", () => {
    expect(nextSet({ sets: [set(140, 5), set(145, 0)] }, null)).toEqual({
      weightKg: 145,
      reps: 1,
      rpe: null,
      kind: "work",
    });
    expect(nextSet({ sets: [set(60, 5, "warmup")] }, null).kind).toBe("warmup");
  });

  test("starts from the empty bar when the exercise is new", () => {
    expect(nextSet({ sets: [] }, null)).toEqual({ weightKg: 20, reps: 5, rpe: null, kind: "work" });
  });
});
