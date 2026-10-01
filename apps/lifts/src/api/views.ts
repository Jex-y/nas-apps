import { asc, eq } from "drizzle-orm";
import type { Entry, Exercise, LiftSet, Workout } from "../contract";
import type { LiftsDb } from "./db";
import { entries, exercises, sets, workouts } from "./schema";

export type LiftsReader = Pick<LiftsDb, "select">;

export const readExercises = (db: LiftsReader, owner: string): Promise<Exercise[]> =>
  db
    .select({ id: exercises.id, name: exercises.name, lift: exercises.lift })
    .from(exercises)
    .where(eq(exercises.owner, owner))
    .orderBy(asc(exercises.name), asc(exercises.id));

export const readWorkouts = async (db: LiftsReader, owner: string): Promise<Workout[]> => {
  const rows = await db
    .select({
      id: workouts.id,
      date: workouts.date,
      finishedAt: workouts.finishedAt,
      notes: workouts.notes,
      bodyweightKg: workouts.bodyweightKg,
    })
    .from(workouts)
    .where(eq(workouts.owner, owner))
    .orderBy(asc(workouts.date), asc(workouts.createdAt), asc(workouts.id));
  return rows.map((row) => ({ ...row, finishedAt: row.finishedAt?.toISOString() ?? null }));
};

export const readEntries = (db: LiftsReader, owner: string): Promise<Entry[]> =>
  db
    .select({
      id: entries.id,
      workoutId: entries.workoutId,
      exerciseId: entries.exerciseId,
      position: entries.position,
      notes: entries.notes,
    })
    .from(entries)
    .where(eq(entries.owner, owner))
    .orderBy(asc(entries.workoutId), asc(entries.position), asc(entries.id));

export const readSets = async (db: LiftsReader, owner: string): Promise<LiftSet[]> => {
  const rows = await db
    .select({
      id: sets.id,
      entryId: sets.entryId,
      position: sets.position,
      weightKg: sets.weightKg,
      reps: sets.reps,
      rpe: sets.rpe,
      kind: sets.kind,
      loggedAt: sets.loggedAt,
    })
    .from(sets)
    .where(eq(sets.owner, owner))
    .orderBy(asc(sets.entryId), asc(sets.position), asc(sets.id));
  return rows.map((row) => ({ ...row, loggedAt: row.loggedAt.toISOString() }));
};
