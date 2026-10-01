import type { LiftSet, Workout } from "../../../../contract";
import { type EntryDetail, type Session, sessionsOf, type WorkoutDetail } from "../../../../log";
import { isWorkSet } from "../../../../strength";

export type SetValues = Pick<LiftSet, "weightKg" | "reps" | "rpe" | "kind">;

/** The empty bar for five, when there is nothing to go on. */
const FIRST_EVER: SetValues = { weightKg: 20, reps: 5, rpe: null, kind: "work" };

/** The most recent other workout, no later than this one, in which the exercise was trained. */
export const lastSession = (
  workouts: readonly WorkoutDetail[],
  workout: Pick<Workout, "id" | "date">,
  exerciseId: string,
): Session | null =>
  sessionsOf(
    workouts.filter((other) => other.id !== workout.id && other.date <= workout.date),
    exerciseId,
  ).at(-1) ?? null;

/**
 * What the next set of an exercise most likely is: the set before it again, or to open with, last session's first
 * work set. The RPE is left to be felt.
 */
export const nextSet = (entry: Pick<EntryDetail, "sets">, lastTime: Session | null): SetValues => {
  const before = entry.sets.at(-1) ?? lastTime?.sets.find(isWorkSet) ?? lastTime?.sets[0];
  return before === undefined
    ? FIRST_EVER
    : { weightKg: before.weightKg, reps: Math.max(before.reps, 1), rpe: null, kind: before.kind };
};
