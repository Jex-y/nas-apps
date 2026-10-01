import { useMemo } from "react";
import type { Entry, LiftSet, Workout } from "../../../../contract";
import { type EntryDetail, nextPosition, type WorkoutDetail } from "../../../../log";
import { useStore } from "../../../hooks/useStore";
import type { Store } from "../../../lib/store";
import { localToday } from "../../../utils/format";
import type { SetValues } from "../utils/prefill";

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

  update: (workout: Workout, fields: WorkoutFields) => {
    store.write(() => {
      store.workouts.update(workout.id, (draft) => {
        Object.assign(draft, fields);
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

  addEntry: (workout: WorkoutDetail, exerciseId: string) => {
    store.write(() => {
      store.entries.insert({
        id: crypto.randomUUID(),
        workoutId: workout.id,
        exerciseId,
        position: nextPosition(workout.entries),
        notes: "",
      });
    });
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

  addSet: (entry: EntryDetail, values: SetValues) => {
    store.write(() => {
      store.sets.insert({
        id: crypto.randomUUID(),
        entryId: entry.id,
        position: nextPosition(entry.sets),
        loggedAt: new Date().toISOString(),
        ...values,
      });
    });
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
