import { useMemo } from "react";
import type { Entry, LiftSet, Workout } from "../../../../contract";
import { type EntryDetail, nextPosition, type WorkoutDetail } from "../../../../log";
import { useStore } from "../../../hooks/useStore";
import type { Store } from "../../../lib/store";
import { localToday } from "../../../utils/format";
import type { SetValues } from "../utils/plan";

type WorkoutFields = Partial<Pick<Workout, "date" | "notes" | "bodyweightKg" | "finishedAt">>;

const actions = (store: Store) => ({
  /** Opens a session for today, answering its id. */
  start: (): string => {
    const id = crypto.randomUUID();
    store.write(() => {
      store.workouts.insert({ id, date: localToday(), finishedAt: null, notes: "", bodyweightKg: null });
    });
    return id;
  },

  /** Opens a session for today with the exercises of a past one, in its order, answering its id. */
  startFrom: (past: WorkoutDetail): string => {
    const id = crypto.randomUUID();
    store.write(() => {
      store.workouts.insert({ id, date: localToday(), finishedAt: null, notes: "", bodyweightKg: null });
      past.entries.forEach((entry, position) => {
        store.entries.insert({
          id: crypto.randomUUID(),
          workoutId: id,
          exerciseId: entry.exerciseId,
          position,
          notes: "",
        });
      });
    });
    return id;
  },

  update: (workout: Workout, fields: WorkoutFields) => {
    store.write(() => {
      store.workouts.update(workout.id, (draft) => {
        Object.assign(draft, fields);
      });
    });
  },

  /** Closes the session, dropping the exercises nothing was logged for. */
  finish: (workout: WorkoutDetail) => {
    store.write(() => {
      for (const entry of workout.entries) {
        if (entry.sets.length === 0) {
          store.entries.delete(entry.id);
        }
      }
      store.workouts.update(workout.id, (draft) => {
        draft.finishedAt = new Date().toISOString();
      });
    });
  },

  remove: (workout: WorkoutDetail) => {
    store.write(() => {
      for (const entry of workout.entries) {
        for (const set of entry.sets) {
          store.sets.delete(set.id);
        }
        store.entries.delete(entry.id);
      }
      store.workouts.delete(workout.id);
    });
  },

  /** Adds an exercise to the end of the workout, answering the id of its place there. */
  addEntry: (workout: WorkoutDetail, exerciseId: string): string => {
    const id = crypto.randomUUID();
    store.write(() => {
      store.entries.insert({
        id,
        workoutId: workout.id,
        exerciseId,
        position: nextPosition(workout.entries),
        notes: "",
      });
    });
    return id;
  },

  updateEntry: (entry: Entry, notes: string) => {
    store.write(() => {
      store.entries.update(entry.id, (draft) => {
        draft.notes = notes;
      });
    });
  },

  removeEntry: (entry: EntryDetail) => {
    store.write(() => {
      for (const set of entry.sets) {
        store.sets.delete(set.id);
      }
      store.entries.delete(entry.id);
    });
  },

  /** Logs a set at a place among the exercise's sets, answering its id. */
  addSet: (entry: EntryDetail, values: SetValues, position = nextPosition(entry.sets)): string => {
    const id = crypto.randomUUID();
    store.write(() => {
      store.sets.insert({
        id,
        entryId: entry.id,
        position,
        loggedAt: new Date().toISOString(),
        ...values,
      });
    });
    return id;
  },

  updateSet: (set: LiftSet, values: Partial<SetValues>) => {
    store.write(() => {
      store.sets.update(set.id, (draft) => {
        Object.assign(draft, values);
      });
    });
  },

  removeSet: (set: LiftSet) => {
    store.write(() => {
      store.sets.delete(set.id);
    });
  },
});

/** Every change to workouts, shown at once and sent when the server can be reached. */
export const useWorkoutActions = () => {
  const store = useStore();
  return useMemo(() => actions(store), [store]);
};

export type WorkoutActions = ReturnType<typeof actions>;
