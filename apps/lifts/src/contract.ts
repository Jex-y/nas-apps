import { z } from "zod";

export const LIFTS_API = "/lifts/api";

/** The lifts contested in powerlifting. At most one of a person's exercises stands for each. */
export const COMPETITION_LIFTS = ["squat", "bench", "deadlift"] as const;
export type CompetitionLift = (typeof COMPETITION_LIFTS)[number];

/** Warm-ups are logged but never count towards estimated maxes, records or volume. */
export const SET_KINDS = ["warmup", "work"] as const;
export type SetKind = (typeof SET_KINDS)[number];

const Id = z.uuid();
const LocalDate = z.iso.date();
const Instant = z.iso.datetime();
const Position = z.number().int().min(0).max(10_000);
const Notes = z.string().max(10_000);
const Kilograms = z.number().min(0).max(1000).multipleOf(0.01);

export const Rpe = z.number().min(1).max(10).multipleOf(0.5);

export const Exercise = z.object({
  id: Id,
  name: z.string().trim().min(1).max(100),
  lift: z.enum(COMPETITION_LIFTS).nullable(),
});
export type Exercise = z.infer<typeof Exercise>;

export const Workout = z.object({
  id: Id,
  /** The training day, wherever in the world it was. */
  date: LocalDate,
  /** `null` while the session is still being logged. */
  finishedAt: Instant.nullable(),
  notes: Notes,
  bodyweightKg: Kilograms.nullable(),
});
export type Workout = z.infer<typeof Workout>;

/** One exercise as performed in one workout, holding its sets. */
export const Entry = z.object({
  id: Id,
  workoutId: Id,
  exerciseId: Id,
  /** Order within the workout; ties fall back to id. */
  position: Position,
  notes: Notes,
});
export type Entry = z.infer<typeof Entry>;

export const LiftSet = z.object({
  id: Id,
  entryId: Id,
  /** Order within the entry; ties fall back to id. */
  position: Position,
  weightKg: Kilograms,
  /** Zero records a missed attempt. */
  reps: z.number().int().min(0).max(100),
  rpe: Rpe.nullable(),
  kind: z.enum(SET_KINDS),
  /** When the set was written down, which for a backfilled session is not when it was lifted. */
  loggedAt: Instant,
});
export type LiftSet = z.infer<typeof LiftSet>;

export const ExerciseList = z.array(Exercise);
export const WorkoutList = z.array(Workout);
export const EntryList = z.array(Entry);
export const LiftSetList = z.array(LiftSet);

const put = <T extends string, R extends z.ZodType>(type: T, row: R) => z.object({ type: z.literal(type), row });
const remove = <T extends string>(type: T) => z.object({ type: z.literal(type), id: Id });

/**
 * One change to someone's log. A put writes the whole row, creating it or replacing what was there, and a delete of
 * something already gone succeeds, so replaying a change is harmless.
 */
export const Mutation = z.discriminatedUnion("type", [
  put("exercise.put", Exercise),
  remove("exercise.delete"),
  put("workout.put", Workout),
  remove("workout.delete"),
  put("entry.put", Entry),
  remove("entry.delete"),
  put("set.put", LiftSet),
  remove("set.delete"),
]);
export type Mutation = z.infer<typeof Mutation>;

/** Changes applied in order, all or nothing. */
export const Push = z.object({ mutations: z.array(Mutation).min(1).max(1000) });
export type Push = z.infer<typeof Push>;

/** Names one push, so a device retrying it after a lost answer does not apply it twice. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IdempotencyKey = z.string().min(1).max(200);
