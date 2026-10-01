import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import type { Log } from "../../log";
import { useStore } from "./useStore";

/** The log as the device holds it: what the server last sent, with every change made here since laid over it. */
export const useLog = (): Log => {
  const store = useStore();
  const exercises = useLiveQuery((q) => q.from({ row: store.exercises }), [store]).data;
  const workouts = useLiveQuery((q) => q.from({ row: store.workouts }), [store]).data;
  const entries = useLiveQuery((q) => q.from({ row: store.entries }), [store]).data;
  const sets = useLiveQuery((q) => q.from({ row: store.sets }), [store]).data;

  return useMemo(() => ({ exercises, workouts, entries, sets }), [exercises, workouts, entries, sets]);
};
