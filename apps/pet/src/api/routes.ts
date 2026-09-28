import { defineRoutes, HttpError, type IdentityMode, parseBody, resolveViewer } from "@nas/core";
import { eq, sql } from "drizzle-orm";
import {
  DEFAULT_STEP_GOAL,
  Hatch,
  type HealthReceipt,
  HealthUpload,
  Interact,
  UNLOCK_STREAKS,
  UpdatePet,
} from "../contract";
import { addDays, londonDate } from "./calendar";
import type { PetDb } from "./db";
import { derivePet, recentDays, rollEgg } from "./life";
import { HISTORY_DAYS, type PetReader, readRecords, viewOf } from "./records";
import { days, goals, interactions, pets } from "./schema";
import type { PetWork } from "./work";

export type PetRoutesDeps = {
  readonly db: PetDb;
  readonly identity: IdentityMode;
  readonly work: PetWork;
  readonly now: () => Date;
  /** Decides what hatches. */
  readonly random: () => number;
};

/** Reads a person's pet for changing it, holding its row so two quick taps cannot both spend the last treat. */
const readForUpdate = async (tx: PetReader, login: string, now: Date) => {
  await tx.select({ id: pets.id }).from(pets).where(eq(pets.login, login)).for("update");
  const records = await readRecords(tx, login, now);
  if (records.pet === null) {
    throw new HttpError(404, "No pet has hatched yet");
  }
  return { ...records, pet: records.pet };
};

export const createPetRoutes = ({ db, identity, work, now, random }: PetRoutesDeps) =>
  defineRoutes({
    "/pet/api/state": {
      GET: async (request) => {
        const { login } = resolveViewer(identity, request);
        const at = now();
        return Response.json(viewOf(await readRecords(db, login, at), at));
      },
    },
    "/pet/api/pet": {
      POST: async (request) => {
        const { login } = resolveViewer(identity, request);
        const { name } = await parseBody(request, Hatch);
        const at = now();
        await db.transaction(async (tx) => {
          const [hatched] = await tx
            .insert(pets)
            .values({ login, name, ...rollEgg(random), hatchedAt: at })
            .onConflictDoNothing()
            .returning({ id: pets.id });
          if (hatched === undefined) {
            throw new HttpError(409, "You already have a pet");
          }
          await tx.insert(goals).values({ petId: hatched.id, since: londonDate(at), steps: DEFAULT_STEP_GOAL });
        });
        return Response.json(viewOf(await readRecords(db, login, at), at), { status: 201 });
      },
      PATCH: async (request) => {
        const { login } = resolveViewer(identity, request);
        const update = await parseBody(request, UpdatePet);
        const at = now();
        await db.transaction(async (tx) => {
          const records = await readForUpdate(tx, login, at);
          const { accessory } = update;
          if (accessory != null && !derivePet({ ...records, now: at }).unlocked.includes(accessory)) {
            throw new HttpError(400, `A ${UNLOCK_STREAKS[accessory]}-day streak unlocks that`);
          }
          if (update.name !== undefined || accessory !== undefined) {
            await tx
              .update(pets)
              .set({
                ...(update.name !== undefined && { name: update.name }),
                ...(accessory !== undefined && { accessory }),
              })
              .where(eq(pets.id, records.pet.id));
          }
          if (update.stepGoal !== undefined) {
            await tx
              .insert(goals)
              .values({ petId: records.pet.id, since: londonDate(at), steps: update.stepGoal })
              .onConflictDoUpdate({ target: [goals.petId, goals.since], set: { steps: update.stepGoal } });
          }
        });
        return Response.json(viewOf(await readRecords(db, login, at), at));
      },
    },
    "/pet/api/interactions": {
      POST: async (request) => {
        const { login } = resolveViewer(identity, request);
        const { kind } = await parseBody(request, Interact);
        const at = now();
        const records = await db.transaction(async (tx) => {
          const current = await readForUpdate(tx, login, at);
          const refusal = derivePet({ ...current, now: at }).refusals[kind];
          if (refusal !== null) {
            throw new HttpError(409, refusal);
          }
          await tx.insert(interactions).values({ petId: current.pet.id, kind, at });
          return { ...current, interactions: [...current.interactions, { kind, at }] };
        });
        return Response.json(viewOf(records, at));
      },
    },
    "/pet/api/history": {
      GET: async (request) => {
        const { login } = resolveViewer(identity, request);
        const at = now();
        const { pet, goals, days } = await readRecords(db, login, at);
        return Response.json(recentDays({ goals, days, hatchedAt: pet?.hatchedAt ?? null, now: at }, HISTORY_DAYS));
      },
    },
    "/pet/api/health": {
      POST: async (request) => {
        const { login } = resolveViewer(identity, request);
        const upload = await parseBody(request, HealthUpload);
        const at = now();
        const latestDate = addDays(londonDate(at), 1);
        if (upload.days.some((day) => day.date > latestDate)) {
          throw new HttpError(400, `Dates after ${latestDate} have not happened yet`);
        }
        // One insert cannot upsert a row twice, so a day sent twice keeps its last total.
        const byDate = new Map(upload.days.map((day) => [day.date, day]));
        await db
          .insert(days)
          .values(
            [...byDate.values()].map((day) => ({
              login,
              date: day.date,
              steps: day.steps,
              distanceMeters: day.distanceMeters ?? null,
              activeEnergyKcal: day.activeEnergyKcal ?? null,
              receivedAt: at,
            })),
          )
          .onConflictDoUpdate({
            target: [days.login, days.date],
            set: {
              steps: sql`excluded.steps`,
              distanceMeters: sql`excluded.distance_meters`,
              activeEnergyKcal: sql`excluded.active_energy_kcal`,
              receivedAt: sql`excluded.received_at`,
            },
          });
        await work.checkNudges(login);
        const receipt: HealthReceipt = { accepted: byDate.size, lastReceivedAt: at.toISOString() };
        return Response.json(receipt);
      },
    },
    "/pet/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
