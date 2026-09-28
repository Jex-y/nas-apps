import { describe, expect, test } from "bun:test";
import type { Interaction } from "../contract";
import { addDays, daysBetween, londonDate, londonHour } from "./calendar";
import {
  type DayTotal,
  derivePet,
  type Goal,
  type InteractionEvent,
  type LifeInput,
  type PetRecord,
  recentDays,
  rollEgg,
  todayOf,
} from "./life";

const HATCHED = new Date("2026-09-01T08:00:00Z");
const EIGHT_K: readonly Goal[] = [{ since: "2026-09-01", steps: 8_000 }];

/** Midday in London (BST) on a September date, when the pet is awake. */
const noon = (date: string) => new Date(`${date}T11:00:00Z`);

/** Consecutive days of walking from `from`, one total per day. */
const walk = (from: string, steps: readonly number[]): DayTotal[] =>
  steps.map((total, index) => ({ date: addDays(from, index), steps: total }));

const events = (kind: Interaction, at: Date, times = 1): InteractionEvent[] =>
  Array.from({ length: times }, () => ({ kind, at }));

/** Greedy only changes what treats do, so most of the maths below is the untouched base rules. */
const life = ({
  pet = {},
  goals = EIGHT_K,
  days = [],
  interactions = [],
  now,
}: Partial<Omit<LifeInput, "pet">> & { pet?: Partial<PetRecord>; now: Date }) =>
  derivePet({
    pet: { name: "Pip", species: "chick", trait: "greedy", accessory: null, hatchedAt: HATCHED, ...pet },
    goals,
    days,
    interactions,
    now,
  });

describe("London calendar", () => {
  test("dates and hours follow British Summer Time and GMT", () => {
    expect(londonDate(new Date("2026-06-01T22:59:00Z"))).toBe("2026-06-01");
    expect(londonDate(new Date("2026-06-01T23:00:00Z"))).toBe("2026-06-02");
    expect(londonDate(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
    expect(londonHour(new Date("2026-06-01T21:30:00Z"))).toBe(22);
    expect(londonHour(new Date("2026-12-01T21:30:00Z"))).toBe(21);
  });

  test("the clocks going forward and back", () => {
    expect(londonHour(new Date("2026-03-29T00:59:00Z"))).toBe(0);
    expect(londonHour(new Date("2026-03-29T01:00:00Z"))).toBe(2);
    expect(londonDate(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
    expect(londonHour(new Date("2026-10-25T00:30:00Z"))).toBe(1);
    expect(londonHour(new Date("2026-10-25T01:30:00Z"))).toBe(1);
  });

  test("steps whole calendar days, whatever their length", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("hatching day", () => {
  test("a new pet is a content baby with nothing earned yet", () => {
    const pet = life({ now: noon("2026-09-01") });

    expect(pet).toMatchObject({
      name: "Pip",
      rarity: "common",
      ageDays: 0,
      stage: "baby",
      form: null,
      condition: "content",
      animation: "idle",
      asleep: false,
      bars: { mood: 60, food: 50, energy: 100 },
      streak: 0,
      bond: 0,
      hearts: 0,
      treats: 0,
      homecomingSteps: null,
      refusals: { treat: "No treats left: one per 2,500 steps", pet: null, play: null },
    });
  });

  test("walking the goal feeds it at once", () => {
    const pet = life({ days: walk("2026-09-01", [8_000]), now: noon("2026-09-01") });

    expect(pet).toMatchObject({ condition: "content", streak: 1, bestStreak: 1, bond: 1, treats: 3 });
    expect(pet.bars).toEqual({ mood: 62, food: 100, energy: 100 });
  });

  test("never counts as a missed day, however late it hatched", () => {
    const pet = life({ pet: { hatchedAt: new Date("2026-09-01T21:00:00Z") }, now: noon("2026-09-02") });

    expect(pet).toMatchObject({ condition: "content", streak: 0 });
  });

  test("food fills as the day's steps approach the goal", () => {
    expect(life({ days: walk("2026-09-01", [4_000]), now: noon("2026-09-01") }).bars.food).toBe(75);
    expect(life({ days: walk("2026-09-01", [7_999]), now: noon("2026-09-01") }).bars.food).toBe(99);
  });
});

describe("streaks", () => {
  test("count fed days in a row, and today only adds once it is fed", () => {
    const days = walk("2026-09-01", [9_000, 9_000, 9_000]);

    expect(life({ days, now: noon("2026-09-04") })).toMatchObject({ streak: 3, condition: "content" });
    expect(life({ days: [...days, ...walk("2026-09-04", [8_000])], now: noon("2026-09-04") }).streak).toBe(4);
  });

  test("break once a day ends short of the goal, keeping the best", () => {
    const pet = life({ days: walk("2026-09-01", [9_000, 9_000, 9_000, 7_000]), now: noon("2026-09-05") });

    expect(pet).toMatchObject({ streak: 0, bestStreak: 3, condition: "hungry" });
  });

  test("raise mood by two a day, up to twenty", () => {
    expect(life({ days: walk("2026-09-01", [9_000, 9_000, 9_000]), now: noon("2026-09-04") }).bars.mood).toBe(66);
    expect(life({ days: walk("2026-09-01", Array(15).fill(9_000)), now: noon("2026-09-16") }).bars.mood).toBe(80);
  });

  test("unlock accessories for good", () => {
    const days = walk("2026-09-01", [...Array(7).fill(9_000), 0, 9_000]);

    const pet = life({ days, pet: { accessory: "party_hat" }, now: noon("2026-09-10") });

    expect(pet).toMatchObject({ streak: 1, bestStreak: 7, unlocked: ["bow", "party_hat"], accessory: "party_hat" });
    expect(life({ pet: { accessory: "crown" }, now: noon("2026-09-01") }).accessory).toBeNull();
  });
});

describe("neglect", () => {
  test("hungry, then sad, then sick as missed days mount", () => {
    const at = (date: string) => life({ now: noon(date) });

    expect(at("2026-09-03")).toMatchObject({ condition: "hungry", animation: "hungry", bars: { mood: 40, food: 25 } });
    expect(at("2026-09-04")).toMatchObject({ condition: "sad", animation: "hungry", bars: { mood: 25, food: 0 } });
    expect(at("2026-09-05")).toMatchObject({ condition: "sick", animation: "sick", bars: { mood: 10, energy: 40 } });
    expect(at("2026-09-08")).toMatchObject({ condition: "sick" });
  });

  test("a treat takes the edge off hunger but cannot feed it", () => {
    const pet = life({
      days: walk("2026-09-01", [9_000, 0]),
      interactions: events("treat", noon("2026-09-03")),
      now: noon("2026-09-03"),
    });

    expect(pet).toMatchObject({ condition: "hungry", bars: { food: 35 } });
  });

  test("a day at the goal cures even a sick pet", () => {
    const pet = life({ days: walk("2026-09-05", [8_500]), now: noon("2026-09-05") });

    expect(pet).toMatchObject({ condition: "content", animation: "idle", streak: 1, bars: { food: 100 } });
  });

  test("a week of missed days and it runs away, halving the bond", () => {
    const days = walk("2026-09-01", [9_000, 9_000, 9_000, 9_000]);

    expect(life({ days, now: noon("2026-09-11") }).condition).toBe("sick");
    const gone = life({ days, now: noon("2026-09-12") });

    expect(gone).toMatchObject({
      condition: "away",
      streak: 0,
      bestStreak: 4,
      bond: 2,
      homecomingSteps: 12_000,
      refusals: { treat: "Pip is away", pet: "Pip is away", play: "Pip is away" },
    });
  });

  test("an ordinary fed day is not enough to bring it home, but half as much again is", () => {
    const neglected = [9_000, 9_000, 9_000, 9_000, 0, 0, 0, 0, 0, 0, 0];
    const at = (after: number[], date: string) =>
      life({ days: walk("2026-09-01", [...neglected, ...after]), now: noon(date) });

    expect(at([9_000], "2026-09-13")).toMatchObject({ condition: "away", homecomingSteps: 12_000 });
    expect(at([9_000, 12_000], "2026-09-14")).toMatchObject({ condition: "content", streak: 1, bond: 3 });
  });

  test("comes home the moment today's walking crosses the mark", () => {
    const neglected = [9_000, 9_000, 9_000, 9_000, 0, 0, 0, 0, 0, 0, 0];

    expect(life({ days: walk("2026-09-01", [...neglected, 11_000]), now: noon("2026-09-12") })).toMatchObject({
      condition: "away",
      homecomingSteps: 1_000,
    });
    expect(life({ days: walk("2026-09-01", [...neglected, 12_000]), now: noon("2026-09-12") })).toMatchObject({
      condition: "content",
      streak: 1,
      homecomingSteps: null,
    });
  });

  test("data that arrives late rewrites the story", () => {
    expect(life({ days: walk("2026-09-01", [0, 9_000]), now: noon("2026-09-03") }).condition).toBe("content");
    expect(life({ days: walk("2026-09-01", [0]), now: noon("2026-09-03") }).condition).toBe("hungry");
  });
});

describe("growing up", () => {
  test("stages follow age in London days", () => {
    const stageOn = (date: string) => life({ now: noon(date) }).stage;

    expect(stageOn("2026-09-02")).toBe("baby");
    expect(stageOn("2026-09-03")).toBe("child");
    expect(stageOn("2026-09-07")).toBe("child");
    expect(stageOn("2026-09-08")).toBe("adult");
    expect(stageOn("2026-10-15")).toBe("adult");
    expect(stageOn("2026-10-16")).toBe("elder");
  });

  test("the adult form reflects how well it was fed as a baby and child", () => {
    const formAfter = (steps: number[]) => life({ days: walk("2026-09-01", steps), now: noon("2026-09-08") }).form;

    expect(formAfter([0, 9_000, 9_000, 9_000, 9_000, 9_000, 0])).toBe("radiant");
    expect(formAfter([0, 9_000, 9_000, 9_000, 0, 0, 0])).toBe("steady");
    expect(formAfter([9_000, 9_000, 0, 9_000, 0, 0, 0, 9_000])).toBe("scruffy");
  });
});

describe("treats", () => {
  test("are earned per 2,500 steps walked since hatching and spent one at a time", () => {
    const days = [{ date: "2026-08-31", steps: 20_000 }, ...walk("2026-09-01", [3_000, 4_600])];

    expect(life({ days, now: noon("2026-09-02") }).treats).toBe(3);
    const fed = life({ days, interactions: events("treat", noon("2026-09-02")), now: noon("2026-09-02") });
    expect(fed).toMatchObject({ treats: 2, bars: { mood: 70, food: 89 } });
  });

  test("three a day is plenty", () => {
    const pet = life({
      days: walk("2026-09-01", [12_000]),
      interactions: events("treat", noon("2026-09-01"), 3),
      now: noon("2026-09-01"),
    });

    expect(pet.treats).toBe(1);
    expect(pet.refusals.treat).toBe("Pip is too full for another treat today");
  });
});

describe("fuss and play", () => {
  test("petting and play lift the mood, and a happy pet looks it", () => {
    const pet = life({
      pet: { trait: "cuddly" },
      interactions: [...events("pet", noon("2026-09-01"), 2)],
      now: noon("2026-09-01"),
    });

    expect(pet.bars.mood).toBe(80);
    expect(pet.animation).toBe("happy");
  });

  test("play costs energy until it is too tired", () => {
    const after = (plays: number, trait: PetRecord["trait"] = "greedy") =>
      life({ pet: { trait }, interactions: events("play", noon("2026-09-01"), plays), now: noon("2026-09-01") });

    expect(after(2).bars).toMatchObject({ energy: 60, mood: 76 });
    expect(after(4).refusals.play).toBeNull();
    expect(after(5).refusals.play).toBe("Pip is too tired to play");
    expect(after(4, "playful").bars.energy).toBe(60);
  });

  test("petting has a daily limit", () => {
    const pet = life({ interactions: events("pet", noon("2026-09-01"), 5), now: noon("2026-09-01") });

    expect(pet.refusals.pet).toBe("Pip has had plenty of fuss today");
  });

  test("a cheerful pet starts every day happier", () => {
    expect(life({ pet: { trait: "cheerful" }, now: noon("2026-09-01") }).bars.mood).toBe(70);
  });

  test("interactions count on the London day they happened", () => {
    const pettedAt = (iso: string) =>
      life({
        pet: { hatchedAt: new Date("2026-06-01T08:00:00Z") },
        days: walk("2026-06-01", [9_000]),
        interactions: events("pet", new Date(iso)),
        now: new Date("2026-06-02T11:00:00Z"),
      }).bars.mood;

    expect(pettedAt("2026-06-01T23:30:00Z")).toBe(67);
    expect(pettedAt("2026-06-01T22:30:00Z")).toBe(62);
  });
});

describe("bond", () => {
  test("grows a point a fed day, two once the streak reaches a week, and one a day of fuss", () => {
    const days = walk("2026-09-01", Array(15).fill(9_000));

    expect(life({ days, now: noon("2026-09-16") })).toMatchObject({ bond: 24, hearts: 2 });
    const fussed = life({
      days,
      interactions: [...events("treat", noon("2026-09-03")), ...events("pet", noon("2026-09-04"), 2)],
      now: noon("2026-09-16"),
    });
    expect(fussed).toMatchObject({ bond: 25, hearts: 3 });
  });
});

describe("sleep", () => {
  test("sleeps from 22:00 to 07:00 London time, summer and winter", () => {
    const winter = { hatchedAt: new Date("2026-11-30T08:00:00Z") };
    const summer = { hatchedAt: new Date("2026-05-30T08:00:00Z") };

    expect(life({ pet: summer, now: new Date("2026-06-01T21:30:00Z") }).asleep).toBe(true);
    expect(life({ pet: winter, now: new Date("2026-12-01T21:30:00Z") }).asleep).toBe(false);
    expect(life({ pet: winter, now: new Date("2026-12-01T22:00:00Z") }).asleep).toBe(true);
    expect(life({ pet: winter, now: new Date("2026-12-02T06:59:00Z") }).asleep).toBe(true);
    expect(life({ pet: winter, now: new Date("2026-12-02T07:00:00Z") }).asleep).toBe(false);
  });

  test("a sleepy pet keeps longer hours", () => {
    const pet = { trait: "sleepy" as const, hatchedAt: new Date("2026-11-30T08:00:00Z") };

    expect(life({ pet, now: new Date("2026-12-01T21:00:00Z") }).asleep).toBe(true);
    expect(life({ pet, now: new Date("2026-12-02T07:30:00Z") }).asleep).toBe(true);
    expect(life({ pet, now: new Date("2026-12-02T08:00:00Z") }).asleep).toBe(false);
  });

  test("asleep, it can be petted but not fed or played with", () => {
    const pet = life({
      days: walk("2026-09-01", [9_000]),
      now: new Date("2026-09-01T22:00:00Z"),
    });

    expect(pet).toMatchObject({
      animation: "sleeping",
      refusals: { treat: "Pip is asleep", pet: null, play: "Pip is asleep" },
    });
  });
});

describe("daylight saving", () => {
  const march = { hatchedAt: new Date("2026-03-27T12:00:00Z") };
  const october = { hatchedAt: new Date("2026-10-23T12:00:00Z") };

  test("a streak runs straight through the short spring day", () => {
    const pet = life({ pet: march, days: walk("2026-03-27", Array(5).fill(9_000)), now: noon("2026-03-31") });

    expect(pet).toMatchObject({ streak: 5, ageDays: 4, stage: "child" });
  });

  test("bedtime moves with the clocks", () => {
    expect(life({ pet: march, now: new Date("2026-03-28T21:30:00Z") }).asleep).toBe(false);
    expect(life({ pet: march, now: new Date("2026-03-29T21:30:00Z") }).asleep).toBe(true);
  });

  test("the long autumn day is one day, fed or missed", () => {
    const missedLongDay = walk("2026-10-23", [9_000, 9_000, 0, 9_000]);

    expect(life({ pet: october, days: missedLongDay, now: noon("2026-10-26") })).toMatchObject({ streak: 1 });
    expect(life({ pet: october, days: missedLongDay, now: noon("2026-10-27") })).toMatchObject({
      streak: 1,
      condition: "content",
    });
    expect(life({ pet: october, now: noon("2026-10-27") })).toMatchObject({ condition: "sick", ageDays: 4 });
  });

  test("steps sent just after midnight BST count for the new day", () => {
    const now = new Date("2026-10-24T23:30:00Z");

    expect(todayOf(EIGHT_K, walk("2026-10-25", [300]), now)).toEqual({
      date: "2026-10-25",
      steps: 300,
      goal: 8_000,
      fed: false,
    });
  });
});

describe("goals", () => {
  const goals: readonly Goal[] = [...EIGHT_K, { since: "2026-09-03", steps: 12_000 }];

  test("a new goal holds from the day it was set, leaving past days as they were", () => {
    const pet = life({ goals, days: walk("2026-09-01", [9_000, 9_000, 9_000]), now: noon("2026-09-03") });

    expect(pet.streak).toBe(2);
    expect(todayOf(goals, [], noon("2026-09-03")).goal).toBe(12_000);
  });

  test("lowering it cannot feed a day already missed", () => {
    const lowered = [...EIGHT_K, { since: "2026-09-03", steps: 5_000 }];

    expect(life({ goals: lowered, days: walk("2026-09-02", [6_000]), now: noon("2026-09-03") }).condition).toBe(
      "hungry",
    );
  });
});

describe("recent days", () => {
  test("lists the last fortnight with which days fed the pet", () => {
    const days = [
      { date: "2026-09-09", steps: 5_000 },
      { date: "2026-09-12", steps: 9_000 },
      { date: "2026-09-14", steps: 3_000 },
    ];
    const recent = recentDays({
      goals: [{ since: "2026-09-10", steps: 8_000 }],
      days,
      hatchedAt: new Date("2026-09-10T08:00:00Z"),
      now: noon("2026-09-14"),
    });

    expect(recent).toHaveLength(14);
    expect(recent[0]?.date).toBe("2026-09-01");
    expect(recent.slice(-6)).toEqual([
      { date: "2026-09-09", steps: 5_000, goal: 8_000, fed: null },
      { date: "2026-09-10", steps: null, goal: 8_000, fed: false },
      { date: "2026-09-11", steps: null, goal: 8_000, fed: false },
      { date: "2026-09-12", steps: 9_000, goal: 8_000, fed: true },
      { date: "2026-09-13", steps: null, goal: 8_000, fed: false },
      { date: "2026-09-14", steps: 3_000, goal: 8_000, fed: false },
    ]);
  });

  test("before hatching, nothing was fed", () => {
    const recent = recentDays({ goals: [], days: [], hatchedAt: null, now: noon("2026-09-14") });

    expect(recent.every((day) => day.fed === null && day.goal === 8_000)).toBe(true);
  });
});

describe("hatching", () => {
  const rolls = (...values: number[]) => {
    const queue = [...values];
    return () => queue.shift() ?? 0;
  };

  test("rarity sets the odds, then species and trait are equally likely", () => {
    expect(rollEgg(rolls(0, 0, 0))).toEqual({ species: "chick", trait: "cheerful" });
    expect(rollEgg(rolls(0.49, 0.5, 0.99))).toEqual({ species: "frog", trait: "sleepy" });
    expect(rollEgg(rolls(0.5, 0.99, 0.2))).toEqual({ species: "bunny", trait: "greedy" });
    expect(rollEgg(rolls(0.85, 0.3, 0))).toEqual({ species: "axolotl", trait: "cheerful" });
    expect(rollEgg(rolls(0.999, 0, 0))).toEqual({ species: "dragon", trait: "cheerful" });
  });
});
