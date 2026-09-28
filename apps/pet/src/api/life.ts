import {
  ACCESSORIES,
  type Accessory,
  type Animation,
  type Condition,
  DEFAULT_STEP_GOAL,
  type Form,
  type HistoryDay,
  type Interaction,
  type PetState,
  RARITIES,
  RARITY,
  type Rarity,
  SPECIES,
  type Species,
  STAGES,
  type Stage,
  type Today,
  TRAITS,
  type Trait,
  UNLOCK_STREAKS,
} from "../contract";
import { addDays, daysBetween, londonDate, londonHour } from "./calendar";

/**
 * A pet's whole state is a pure function of its row, its owner's daily steps, its interactions and the time, so
 * nothing decays on a timer and late or corrected Health data simply rewrites the story.
 *
 * Each complete London day since hatching is either fed (steps met that day's goal) or missed. Missed days in a row
 * make it hungry, then sad, then sick; a week of them and it runs away, coming home on a day of half as much again
 * as the goal. The day it hatched can only count for it, and today counts once the goal is met.
 */

/** A day at the goal earns three treats, with some left over. */
export const TREAT_STEPS = 2_500;
/** It is too full for more treats than this in a day. */
export const TREATS_PER_DAY = 3;
export const PETS_PER_DAY = 5;
/** Missed days in a row after which it runs away. */
export const RUNAWAY_AFTER = 7;
/** It comes home on a day with this multiple of the goal. */
export const HOMECOMING_FACTOR = 1.5;
/** Streak length from which each fed day bonds twice as much. */
export const LOYAL_STREAK = 7;
/** Age in days at which each stage begins. */
export const STAGE_AGES: Readonly<Record<Stage, number>> = { baby: 0, child: 2, adult: 7, elder: 45 };
/** Bond needed for each of the five hearts. */
export const HEART_BONDS = [3, 10, 25, 50, 100] as const;
/** Chance an egg holds each rarity; the species of one rarity are equally likely. */
export const HATCH_ODDS: Readonly<Record<Rarity, number>> = { common: 0.5, uncommon: 0.3, rare: 0.15, legendary: 0.05 };

/** Mood before today's streak and fuss are added. */
const CONDITION_MOOD: Readonly<Record<Condition, number>> = { content: 60, hungry: 40, sad: 25, sick: 10, away: 0 };

const EFFECTS = {
  mood: 0,
  treatMood: 5,
  petMood: 5,
  playMood: 8,
  playEnergy: 20,
  bedtime: 22,
  wakes: 7,
};

/** Each trait bends exactly one rule. */
export const TRAIT_EFFECTS: Readonly<Record<Trait, Partial<typeof EFFECTS>>> = {
  cheerful: { mood: 10 },
  greedy: { treatMood: 10 },
  cuddly: { petMood: 10 },
  playful: { playEnergy: 10 },
  sleepy: { bedtime: 21, wakes: 8 },
};

export type PetRecord = {
  readonly name: string;
  readonly species: Species;
  readonly trait: Trait;
  readonly accessory: Accessory | null;
  readonly hatchedAt: Date;
};

export type Goal = { readonly since: string; readonly steps: number };
export type DayTotal = { readonly date: string; readonly steps: number };
export type InteractionEvent = { readonly kind: Interaction; readonly at: Date };

export type LifeInput = {
  readonly pet: PetRecord;
  readonly goals: readonly Goal[];
  readonly days: readonly DayTotal[];
  readonly interactions: readonly InteractionEvent[];
  readonly now: Date;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

/** Looks up the goal in force on a date: the latest set on or before it, or the first for earlier dates. */
export const goalSchedule = (goals: readonly Goal[]): ((date: string) => number) => {
  const sorted = goals.toSorted((a, b) => a.since.localeCompare(b.since));
  return (date) => sorted.findLast((goal) => goal.since <= date)?.steps ?? sorted[0]?.steps ?? DEFAULT_STEP_GOAL;
};

const stepsByDate = (days: readonly DayTotal[]) => new Map(days.map((day) => [day.date, day.steps]));

export const todayOf = (goals: readonly Goal[], days: readonly DayTotal[], now: Date): Today => {
  const date = londonDate(now);
  const steps = stepsByDate(days).get(date) ?? 0;
  const goal = goalSchedule(goals)(date);
  return { date, steps, goal, fed: steps >= goal };
};

/** The last `length` days up to today, with which of them fed the pet. */
export const recentDays = (
  { goals, days, hatchedAt, now }: Pick<LifeInput, "goals" | "days" | "now"> & { readonly hatchedAt: Date | null },
  length = 14,
): HistoryDay[] => {
  const today = londonDate(now);
  const born = hatchedAt === null ? null : londonDate(hatchedAt);
  const stepsOn = stepsByDate(days);
  const goalOn = goalSchedule(goals);
  return Array.from({ length }, (_, index) => {
    const date = addDays(today, index + 1 - length);
    const steps = stepsOn.get(date) ?? null;
    const goal = goalOn(date);
    return { date, steps, goal, fed: born === null || date < born ? null : (steps ?? 0) >= goal };
  });
};

const stageAt = (age: number): Stage => STAGES.findLast((stage) => age >= STAGE_AGES[stage]) ?? "baby";

/** Fed days as a baby and child (ages 1 to 6) decide the adult form, as in the original Tamagotchi. */
const formFrom = (childhoodFed: number): Form =>
  childhoodFed >= 5 ? "radiant" : childhoodFed >= 3 ? "steady" : "scruffy";

const conditionAfter = (missed: number, away: boolean): Condition =>
  away ? "away" : missed === 0 ? "content" : missed === 1 ? "hungry" : missed === 2 ? "sad" : "sick";

const animationFor = (condition: Condition, asleep: boolean, mood: number): Animation =>
  asleep
    ? "sleeping"
    : condition === "sick"
      ? "sick"
      : condition === "hungry" || condition === "sad"
        ? "hungry"
        : mood >= 75
          ? "happy"
          : "idle";

export const derivePet = ({ pet, goals, days, interactions, now }: LifeInput): PetState => {
  const today = londonDate(now);
  const born = londonDate(pet.hatchedAt);
  const stepsOn = stepsByDate(days);
  const goalOn = goalSchedule(goals);
  const interactionsOn = Map.groupBy(interactions, (event) => londonDate(event.at));
  const effects = { ...EFFECTS, ...TRAIT_EFFECTS[pet.trait] };

  let streak = 0;
  let bestStreak = 0;
  let missed = 0;
  let away = false;
  let bond = 0;
  let walked = 0;
  let childhoodFed = 0;
  for (let date = born; date <= today; date = addDays(date, 1)) {
    const steps = stepsOn.get(date) ?? 0;
    const goal = goalOn(date);
    walked += steps;
    if (away && steps >= goal * HOMECOMING_FACTOR) {
      away = false;
      missed = 0;
    }
    if (away) {
      continue;
    }
    if (steps >= goal) {
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      missed = 0;
      bond += streak >= LOYAL_STREAK ? 2 : 1;
      const age = daysBetween(born, date);
      childhoodFed += age >= 1 && age < STAGE_AGES.adult ? 1 : 0;
    } else if (date < today && date !== born) {
      streak = 0;
      missed += 1;
      if (missed >= RUNAWAY_AFTER) {
        away = true;
        bond = Math.floor(bond / 2);
        continue;
      }
    }
    bond += interactionsOn.get(date)?.some((event) => event.kind !== "treat") ? 1 : 0;
  }

  const { steps, goal, fed } = todayOf(goals, days, now);
  const condition = conditionAfter(missed, away);
  const todays = interactionsOn.get(today) ?? [];
  const tally = (kind: Interaction) => todays.filter((event) => event.kind === kind).length;
  const [treated, petted, played] = [tally("treat"), tally("pet"), tally("play")];

  const hour = londonHour(now);
  const asleep = hour >= effects.bedtime || hour < effects.wakes;
  const age = Math.max(0, daysBetween(born, today));
  const stage = stageAt(age);
  const treats = Math.max(
    0,
    Math.floor(walked / TREAT_STEPS) - interactions.filter((event) => event.kind === "treat").length,
  );
  const bars = {
    mood: clamp(
      CONDITION_MOOD[condition] +
        effects.mood +
        Math.min(20, 2 * streak) +
        effects.treatMood * treated +
        effects.petMood * petted +
        effects.playMood * played,
      0,
      100,
    ),
    food: fed ? 100 : clamp(50 + (50 * steps) / goal - 25 * missed + 10 * treated, 0, 99),
    energy: clamp(100 - effects.playEnergy * played, 0, condition === "sick" ? 40 : 100),
  };
  const unlocked = ACCESSORIES.filter((accessory) => bestStreak >= UNLOCK_STREAKS[accessory]);

  const refusal = (checks: readonly [boolean, string][]) => checks.find(([refused]) => refused)?.[1] ?? null;
  const awayOrAsleep: [boolean, string][] = [
    [away, `${pet.name} is away`],
    [asleep, `${pet.name} is asleep`],
  ];

  return {
    name: pet.name,
    species: pet.species,
    rarity: RARITY[pet.species],
    trait: pet.trait,
    hatchedAt: pet.hatchedAt.toISOString(),
    ageDays: age,
    stage,
    form: stage === "baby" || stage === "child" ? null : formFrom(childhoodFed),
    condition,
    animation: animationFor(condition, asleep, bars.mood),
    asleep,
    bars,
    streak,
    bestStreak,
    bond,
    hearts: HEART_BONDS.filter((needed) => bond >= needed).length,
    treats,
    accessory: pet.accessory !== null && unlocked.includes(pet.accessory) ? pet.accessory : null,
    unlocked,
    homecomingSteps: away ? Math.ceil(goal * HOMECOMING_FACTOR) - steps : null,
    refusals: {
      treat: refusal([
        ...awayOrAsleep,
        [treats === 0, `No treats left: one per ${TREAT_STEPS.toLocaleString("en-GB")} steps`],
        [treated >= TREATS_PER_DAY, `${pet.name} is too full for another treat today`],
      ]),
      pet: refusal([
        [away, `${pet.name} is away`],
        [petted >= PETS_PER_DAY, `${pet.name} has had plenty of fuss today`],
      ]),
      play: refusal([...awayOrAsleep, [bars.energy < effects.playEnergy, `${pet.name} is too tired to play`]]),
    },
  };
};

const pick = <T>(items: readonly T[], random: () => number): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error("Cannot pick from nothing");
  }
  return item;
};

const rarityFor = (roll: number): Rarity => {
  let ceiling = 0;
  for (const rarity of RARITIES) {
    ceiling += HATCH_ODDS[rarity];
    if (roll < ceiling) {
      return rarity;
    }
  }
  return "common";
};

/** What hatches: `random` is `Math.random` outside tests. */
export const rollEgg = (random: () => number): { species: Species; trait: Trait } => {
  const rarity = rarityFor(random());
  return {
    species: pick(
      SPECIES.filter((species) => RARITY[species] === rarity),
      random,
    ),
    trait: pick(TRAITS, random),
  };
};
