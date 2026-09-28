import type { JobQueue, Notification, Notifier, RegisteredJob, Schedule } from "@nas/core";
import { defineJob, defineSchedule } from "@nas/core";
import { z } from "zod";
import { type Condition, type PetView, STALE_HEALTH_HOURS, type Trait } from "../contract";
import { londonDate, londonHour } from "./calendar";
import type { PetDb } from "./db";
import { readRecords, viewOf } from "./records";
import { type nudgeKind, nudges, pets } from "./schema";

export type PetWorkDeps = {
  readonly db: PetDb;
  readonly queue: JobQueue;
  /** Reaches only the pet's owner. */
  readonly notifier: (login: string) => Notifier;
  readonly publicUrl: string;
  readonly now: () => Date;
};

type NudgeKind = (typeof nudgeKind.enumValues)[number];
export type Nudge = { readonly kind: NudgeKind; readonly notification: Notification };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** London hour from which a pet short of its goal nudges its owner. */
export const EVENING_HOUR = 18;

/** How a pet feels while its owner is short of the goal; a content one shows its personality. */
const FEELINGS: Readonly<Record<Trait, string>> = {
  cheerful: "hopeful",
  greedy: "peckish",
  cuddly: "lonely",
  playful: "restless",
  sleepy: "sluggish",
};
const UNWELL: Readonly<Partial<Record<Condition, string>>> = { hungry: "hungry", sad: "sad", sick: "poorly" };

const steps = (count: number) => count.toLocaleString("en-GB");
const sentAt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * What to tell the owner now, before checking what has already gone out today. Nothing while the pet sleeps; stale
 * data rules out judging the day, so it is reported instead.
 */
export const dueNudges = ({ pet, today, lastHealthAt }: PetView, now: Date, publicUrl: string): Nudge[] => {
  if (pet === null || pet.asleep) {
    return [];
  }
  const home = `${publicUrl}/pet/`;
  if (lastHealthAt !== null && now.getTime() - Date.parse(lastHealthAt) > STALE_HEALTH_HOURS * HOUR) {
    return [
      {
        kind: "stale",
        notification: {
          title: "No steps from Apple Health",
          message: `Nothing has arrived since ${sentAt.format(new Date(lastHealthAt))}, so ${pet.name} cannot tell how far you walked.`,
          clickUrl: `${publicUrl}/pet/health`,
        },
      },
    ];
  }
  if (pet.homecomingSteps === null && today.fed) {
    return [
      {
        kind: "goal",
        notification: {
          title: `${pet.name} is full`,
          message: `Goal reached with ${steps(today.steps)} steps: ${pet.streak === 1 ? "a new streak begins" : `${pet.streak} days in a row`}.`,
          clickUrl: home,
        },
      },
    ];
  }
  if (londonHour(now) < EVENING_HOUR) {
    return [];
  }
  const message =
    pet.homecomingSteps === null
      ? `${pet.name} is ${UNWELL[pet.condition] ?? FEELINGS[pet.trait]}: ${steps(today.goal - today.steps)} steps to go`
      : `${pet.name} is still out there: ${steps(pet.homecomingSteps)} more steps today would bring them home`;
  return [{ kind: "evening", notification: { title: pet.name, message, clickUrl: home } }];
};

export const createPetWork = (deps: PetWorkDeps) => {
  const { db, queue } = deps;

  /** A nudge is claimed and sent in one transaction, so a failed send is retried rather than lost or repeated. */
  const nudge = defineJob({
    name: "pet.nudge",
    payload: z.object({ login: z.string().min(1) }),
    handle: async ({ login }) => {
      const now = deps.now();
      const records = await readRecords(db, login, now);
      const petId = records.pet?.id;
      if (petId === undefined) {
        return;
      }
      for (const { kind, notification } of dueNudges(viewOf(records, now), now, deps.publicUrl)) {
        await db.transaction(async (tx) => {
          const claimed = await tx
            .insert(nudges)
            .values({ petId, date: londonDate(now), kind })
            .onConflictDoNothing()
            .returning({ kind: nudges.kind });
          if (claimed.length > 0) {
            await deps.notifier(login).send(notification);
          }
        });
      }
    },
  });

  const checkNudges = (login: string) => queue.enqueue(nudge, { login }, { dedupeKey: login });

  const sweepNudges = defineJob({
    name: "pet.sweep-nudges",
    payload: z.object({}),
    handle: async () => {
      for (const { login } of await db.select({ login: pets.login }).from(pets)) {
        await checkNudges(login);
      }
    },
  });

  const jobs: readonly RegisteredJob[] = [nudge, sweepNudges];

  const schedules: readonly Schedule[] = [
    defineSchedule({ name: "pet.sweep-nudges", everyMs: 15 * MINUTE, jitterMs: MINUTE, job: sweepNudges, payload: {} }),
  ];

  return {
    jobs,
    schedules,
    definitions: { nudge, sweepNudges },
    /** Checks one owner's nudges soon, e.g. straight after new steps arrive, rather than at the next sweep. */
    checkNudges,
  };
};

export type PetWork = ReturnType<typeof createPetWork>;
