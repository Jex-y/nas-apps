import { HttpError } from "@apps/core";
import { and, count, eq } from "drizzle-orm";
import type { Entry, Exercise, LiftSet, Mutation, Workout } from "../contract";
import type { Log } from "../log";
import type { LiftsDb } from "./db";
import { entries, exercises, pushes, sets, workouts } from "./schema";
import { readEntries, readExercises, readSets, readWorkouts } from "./views";

export type LiftsServiceDeps = { readonly db: LiftsDb };

type Tx = Parameters<Parameters<LiftsDb["transaction"]>[0]>[0];

/** A row written under an id that already belongs to someone else changes nothing, and is refused as if not there. */
const requireWritten = (written: readonly unknown[]) => {
  if (written.length === 0) {
    throw new HttpError(404, "Not found");
  }
};

const requireOwn = async (found: Promise<readonly unknown[]>, missing: string) => {
  if ((await found).length === 0) {
    throw new HttpError(409, missing);
  }
};

const putExercise = async (tx: Tx, owner: string, { id, ...fields }: Exercise) => {
  if (fields.lift !== null) {
    const [holder] = await tx
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(and(eq(exercises.owner, owner), eq(exercises.lift, fields.lift)));
    if (holder !== undefined && holder.id !== id) {
      throw new HttpError(409, `"${holder.name}" is already your ${fields.lift}`);
    }
  }
  requireWritten(
    await tx
      .insert(exercises)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: exercises.id, set: fields, setWhere: eq(exercises.owner, owner) })
      .returning({ id: exercises.id }),
  );
};

const deleteExercise = async (tx: Tx, owner: string, id: string) => {
  const [exercise] = await tx
    .select({ name: exercises.name })
    .from(exercises)
    .where(and(eq(exercises.id, id), eq(exercises.owner, owner)));
  if (exercise === undefined) {
    return;
  }
  const [used] = await tx
    .select({ entries: count() })
    .from(entries)
    .where(and(eq(entries.owner, owner), eq(entries.exerciseId, id)));
  if (used !== undefined && used.entries > 0) {
    throw new HttpError(409, `"${exercise.name}" has been logged ${used.entries} times, so it cannot be deleted`);
  }
  await tx.delete(exercises).where(and(eq(exercises.id, id), eq(exercises.owner, owner)));
};

const putWorkout = async (tx: Tx, owner: string, { id, finishedAt, ...fields }: Workout) => {
  const values = { ...fields, finishedAt: finishedAt === null ? null : new Date(finishedAt) };
  requireWritten(
    await tx
      .insert(workouts)
      .values({ id, owner, ...values })
      .onConflictDoUpdate({ target: workouts.id, set: values, setWhere: eq(workouts.owner, owner) })
      .returning({ id: workouts.id }),
  );
};

const putEntry = async (tx: Tx, owner: string, { id, ...fields }: Entry) => {
  await requireOwn(
    tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(eq(workouts.id, fields.workoutId), eq(workouts.owner, owner))),
    "That workout no longer exists",
  );
  await requireOwn(
    tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.id, fields.exerciseId), eq(exercises.owner, owner))),
    "That exercise no longer exists",
  );
  requireWritten(
    await tx
      .insert(entries)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: entries.id, set: fields, setWhere: eq(entries.owner, owner) })
      .returning({ id: entries.id }),
  );
};

const putSet = async (tx: Tx, owner: string, { id, loggedAt, ...fields }: LiftSet) => {
  await requireOwn(
    tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, fields.entryId), eq(entries.owner, owner))),
    "That exercise is no longer in the workout",
  );
  const values = { ...fields, loggedAt: new Date(loggedAt) };
  requireWritten(
    await tx
      .insert(sets)
      .values({ id, owner, ...values })
      .onConflictDoUpdate({ target: sets.id, set: values, setWhere: eq(sets.owner, owner) })
      .returning({ id: sets.id }),
  );
};

const applyOne = async (tx: Tx, owner: string, mutation: Mutation): Promise<void> => {
  switch (mutation.type) {
    case "exercise.put":
      return putExercise(tx, owner, mutation.row);
    case "exercise.delete":
      return deleteExercise(tx, owner, mutation.id);
    case "workout.put":
      return putWorkout(tx, owner, mutation.row);
    case "workout.delete":
      await tx.delete(workouts).where(and(eq(workouts.id, mutation.id), eq(workouts.owner, owner)));
      return;
    case "entry.put":
      return putEntry(tx, owner, mutation.row);
    case "entry.delete":
      await tx.delete(entries).where(and(eq(entries.id, mutation.id), eq(entries.owner, owner)));
      return;
    case "set.put":
      return putSet(tx, owner, mutation.row);
    case "set.delete":
      await tx.delete(sets).where(and(eq(sets.id, mutation.id), eq(sets.owner, owner)));
      return;
  }
};

const applyAll = async (tx: Tx, owner: string, mutations: readonly Mutation[]) => {
  for (const mutation of mutations) {
    await applyOne(tx, owner, mutation);
  }
};

/**
 * Everything someone can do with their training log, shared by the HTTP API and the MCP server. Refusals are
 * {@link HttpError}s saying why. Nobody can see or touch another's log.
 */
export const createLiftsService = ({ db }: LiftsServiceDeps) => ({
  exercises: (owner: string) => readExercises(db, owner),
  workouts: (owner: string) => readWorkouts(db, owner),
  entries: (owner: string) => readEntries(db, owner),
  sets: (owner: string) => readSets(db, owner),

  log: async (owner: string): Promise<Log> => ({
    exercises: await readExercises(db, owner),
    workouts: await readWorkouts(db, owner),
    entries: await readEntries(db, owner),
    sets: await readSets(db, owner),
  }),

  /** Applies the changes in order, all or nothing. */
  apply: (owner: string, mutations: readonly Mutation[]): Promise<void> =>
    db.transaction((tx) => applyAll(tx, owner, mutations)),

  /** {@link apply}, at most once per key: a push that was refused may be sent again, one that landed is ignored. */
  push: (owner: string, key: string, mutations: readonly Mutation[]): Promise<void> =>
    db.transaction(async (tx) => {
      const claimed = await tx
        .insert(pushes)
        .values({ owner, key })
        .onConflictDoNothing()
        .returning({ key: pushes.key });
      if (claimed.length > 0) {
        await applyAll(tx, owner, mutations);
      }
    }),
});

export type LiftsService = ReturnType<typeof createLiftsService>;
