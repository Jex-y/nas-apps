import type { Entry, Exercise, LiftSet, Workout } from "./contract";

/** Everything one person has logged. */
export type Log = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly Workout[];
  readonly entries: readonly Entry[];
  readonly sets: readonly LiftSet[];
};

export type EntryDetail = Entry & { readonly exercise: Exercise; readonly sets: readonly LiftSet[] };
export type WorkoutDetail = Workout & { readonly entries: readonly EntryDetail[] };

type Placed = { readonly id: string; readonly position: number };

export const byPosition = (a: Placed, b: Placed): number => a.position - b.position || a.id.localeCompare(b.id);

/** Oldest first; workouts on the same day keep the order they were given in. */
export const byDate = (a: Workout, b: Workout): number => a.date.localeCompare(b.date);

/** Each workout with its exercises and their sets in order, oldest workout first. */
export const workoutDetails = ({ exercises, workouts, entries, sets }: Log): WorkoutDetail[] => {
  const exerciseOf = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const setsOf = Map.groupBy(sets, (set) => set.entryId);
  const entriesOf = Map.groupBy(entries, (entry) => entry.workoutId);

  return workouts.toSorted(byDate).map((workout) => ({
    ...workout,
    entries: (entriesOf.get(workout.id) ?? []).toSorted(byPosition).flatMap((entry) => {
      const exercise = exerciseOf.get(entry.exerciseId);
      return exercise === undefined
        ? []
        : [{ ...entry, exercise, sets: (setsOf.get(entry.id) ?? []).toSorted(byPosition) }];
    }),
  }));
};

export type Session = { readonly workout: Workout; readonly sets: readonly LiftSet[] };

/** Each workout an exercise was trained in, with every set of it that day, oldest first. */
export const sessionsOf = (workouts: readonly WorkoutDetail[], exerciseId: string): Session[] =>
  workouts.flatMap((workout) => {
    const sets = workout.entries.filter((entry) => entry.exerciseId === exerciseId).flatMap((entry) => entry.sets);
    return sets.length === 0 ? [] : [{ workout, sets }];
  });

/** One past the last position in use, for appending. */
export const nextPosition = (placed: readonly Placed[]): number =>
  placed.reduce((next, { position }) => Math.max(next, position + 1), 0);
