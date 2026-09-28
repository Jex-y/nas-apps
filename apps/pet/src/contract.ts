import { z } from "zod";

export const PET_API = "/pet/api";

export const SPECIES = ["chick", "frog", "cat", "bunny", "axolotl", "dragon"] as const;
export type Species = (typeof SPECIES)[number];

export const RARITIES = ["common", "uncommon", "rare", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY: Readonly<Record<Species, Rarity>> = {
  chick: "common",
  frog: "common",
  cat: "uncommon",
  bunny: "uncommon",
  axolotl: "rare",
  dragon: "legendary",
};

export const TRAITS = ["cheerful", "greedy", "cuddly", "playful", "sleepy"] as const;
export type Trait = (typeof TRAITS)[number];

export const STAGES = ["baby", "child", "adult", "elder"] as const;
export type Stage = (typeof STAGES)[number];

/** How an adult turned out, set by how well it was fed as a baby and child. */
export const FORMS = ["radiant", "steady", "scruffy"] as const;
export type Form = (typeof FORMS)[number];

export const ACCESSORIES = ["bow", "party_hat", "crown"] as const;
export type Accessory = (typeof ACCESSORIES)[number];

/** The best streak, in days, that unlocks each accessory for good. */
export const UNLOCK_STREAKS: Readonly<Record<Accessory, number>> = { bow: 3, party_hat: 7, crown: 14 };

export const CONDITIONS = ["content", "hungry", "sad", "sick", "away"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const ANIMATIONS = ["idle", "happy", "walking", "hungry", "sleeping", "sick"] as const;
export type Animation = (typeof ANIMATIONS)[number];

export const INTERACTIONS = ["treat", "pet", "play"] as const;
export type Interaction = (typeof INTERACTIONS)[number];

export const DEFAULT_STEP_GOAL = 8_000;

/**
 * The Shortcut cannot read Health while the iPhone is locked, so gaps of hours are normal; only after this long
 * without data is it probably broken.
 */
export const STALE_HEALTH_HOURS = 36;

const LocalDate = z.iso.date();
const count = z.number().int().nonnegative();
const percent = z.number().int().min(0).max(100);

const measure = z.number().nonnegative().max(1_000_000);

/**
 * What the iOS app (or the Shortcut) posts: each day's totals so far, keyed by the phone's local date. Every day is
 * an upsert, so resending a day replaces it.
 */
export const HealthUpload = z.object({
  days: z
    .array(
      z.object({
        date: LocalDate,
        steps: measure.int(),
        distanceMeters: measure.optional(),
        activeEnergyKcal: measure.optional(),
      }),
    )
    .min(1)
    .max(31),
});
export type HealthUpload = z.infer<typeof HealthUpload>;

export const HealthReceipt = z.object({ accepted: count, lastReceivedAt: z.iso.datetime() });
export type HealthReceipt = z.infer<typeof HealthReceipt>;

const PetName = z.string().trim().min(1).max(24);
export const StepGoal = z.number().int().min(1_000).max(50_000);

export const Hatch = z.object({ name: PetName });
export type Hatch = z.infer<typeof Hatch>;

export const UpdatePet = z
  .object({
    name: PetName.optional(),
    stepGoal: StepGoal.optional(),
    accessory: z.enum(ACCESSORIES).nullable().optional(),
  })
  .refine((update) => Object.keys(update).length > 0, { message: "Nothing to update" });
export type UpdatePet = z.infer<typeof UpdatePet>;

export const Interact = z.object({ kind: z.enum(INTERACTIONS) });

export const Today = z.object({
  date: LocalDate,
  steps: count,
  goal: count,
  fed: z.boolean(),
});
export type Today = z.infer<typeof Today>;

export const PetState = z.object({
  name: z.string(),
  species: z.enum(SPECIES),
  rarity: z.enum(RARITIES),
  trait: z.enum(TRAITS),
  hatchedAt: z.iso.datetime(),
  ageDays: count,
  stage: z.enum(STAGES),
  /** `null` until it grows up. */
  form: z.enum(FORMS).nullable(),
  condition: z.enum(CONDITIONS),
  animation: z.enum(ANIMATIONS),
  asleep: z.boolean(),
  bars: z.object({ mood: percent, food: percent, energy: percent }),
  streak: count,
  bestStreak: count,
  bond: count,
  hearts: z.number().int().min(0).max(5),
  treats: count,
  accessory: z.enum(ACCESSORIES).nullable(),
  unlocked: z.array(z.enum(ACCESSORIES)),
  /** Steps today that bring it home while it is away; `null` while it is home. */
  homecomingSteps: count.nullable(),
  /** Why each interaction is refused right now; `null` when it is allowed. */
  refusals: z.object({ treat: z.string().nullable(), pet: z.string().nullable(), play: z.string().nullable() }),
});
export type PetState = z.infer<typeof PetState>;

export const PetView = z.object({
  today: Today,
  /** When the Shortcut last sent anything; `null` before it ever has. */
  lastHealthAt: z.iso.datetime().nullable(),
  /** `null` until the egg hatches. */
  pet: PetState.nullable(),
});
export type PetView = z.infer<typeof PetView>;

export const HistoryDay = z.object({
  date: LocalDate,
  /** `null` when Health sent nothing for the day. */
  steps: count.nullable(),
  goal: count,
  /** `null` before the pet hatched. */
  fed: z.boolean().nullable(),
});
export type HistoryDay = z.infer<typeof HistoryDay>;

export const History = z.array(HistoryDay);
