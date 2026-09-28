import { describe, expect, test } from "bun:test";
import { startTestServer, uniqueLogin } from "@nas/core/testing";
import { createPetTestbed, NOON } from "../../test/support";
import { HealthReceipt, History, PetView } from "../contract";
import { createPetApp } from "../module";

const { context, hatch, walk } = createPetTestbed();
const request = startTestServer((ctx) => [createPetApp(ctx, { now: () => NOON, random: () => 0 })], context);

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

const stateOf = async (login: string) => PetView.parse(await (await request("/pet/api/state", { as: login })).json());

const sendHealth = (login: string, days: unknown) =>
  request("/pet/api/health", { as: login, ...json("POST", { days }) });

const interact = (login: string, kind: string) =>
  request("/pet/api/interactions", { as: login, ...json("POST", { kind }) });

describe("pet api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/pet/api/state")).status).toBe(401);
    expect((await request("/pet/api/health", json("POST", { days: [] }))).status).toBe(401);
  });

  test("serves the page, and JSON 404s for unknown API paths", async () => {
    expect(await (await request("/pet/")).text()).toContain('<div id="root">');
    expect((await request("/pet/api/nope", { as: uniqueLogin() })).status).toBe(404);
  });

  test("before hatching there is an egg and today's goal", async () => {
    expect(await stateOf(uniqueLogin())).toEqual({
      today: { date: "2026-09-21", steps: 0, goal: 8_000, fed: false },
      lastHealthAt: null,
      pet: null,
    });
  });
});

describe("health ingest", () => {
  test("upserts each day, the latest total winning, and says what it took", async () => {
    const me = uniqueLogin();

    const response = await sendHealth(me, [
      { date: "2026-09-20", steps: 9_100, distanceMeters: 6120.5, activeEnergyKcal: 410.2 },
      { date: "2026-09-21", steps: 3_000 },
    ]);
    expect(response.status).toBe(200);
    expect(HealthReceipt.parse(await response.json())).toEqual({ accepted: 2, lastReceivedAt: NOON.toISOString() });

    await sendHealth(me, [{ date: "2026-09-21", steps: 2_500 }]);
    const view = await stateOf(me);
    expect(view.today.steps).toBe(2_500);
    expect(view.lastHealthAt).toBe(NOON.toISOString());
    const [yesterday] = await context.sql`select * from pet.days where login = ${me} and date = '2026-09-20'`;
    expect(yesterday).toMatchObject({ steps: 9_100, distance_meters: 6120.5, active_energy_kcal: 410.2 });
  });

  test("keeps the last of a day sent twice in one request", async () => {
    const me = uniqueLogin();

    const response = await sendHealth(me, [
      { date: "2026-09-21", steps: 1_000 },
      { date: "2026-09-21", steps: 1_500 },
    ]);

    expect(await response.json()).toMatchObject({ accepted: 1 });
    expect((await stateOf(me)).today.steps).toBe(1_500);
  });

  test("keeps each person's steps to themselves", async () => {
    await sendHealth(uniqueLogin(), [{ date: "2026-09-21", steps: 5_000 }]);

    expect((await stateOf(uniqueLogin())).today.steps).toBe(0);
  });

  test("refuses what is not a day's totals", async () => {
    const me = uniqueLogin();
    for (const days of [
      [],
      [{ date: "2026-09-21", steps: -1 }],
      [{ date: "2026-09-21", steps: 12.5 }],
      [{ date: "21/09/2026", steps: 100 }],
      [{ date: "2026-09-21" }],
      [{ date: "2026-09-21", steps: 100, distanceMeters: -3 }],
      [{ date: "2026-09-23", steps: 100 }],
    ]) {
      expect((await sendHealth(me, days)).status).toBe(400);
    }
    expect((await request("/pet/api/health", { as: me, method: "POST", body: "steps=5" })).status).toBe(400);
  });

  test("asks for the owner's nudges to be checked", async () => {
    const me = uniqueLogin();
    await sendHealth(me, [{ date: "2026-09-21", steps: 100 }]);

    const queued = await context.sql`select payload from jobs.jobs where name = 'pet.nudge' and state = 'pending'`;
    expect(queued).toContainEqual({ payload: { login: me } });
  });
});

describe("hatching", () => {
  test("hatches one pet per person, named by them", async () => {
    const me = uniqueLogin();

    const response = await request("/pet/api/pet", { as: me, ...json("POST", { name: "  Pip " }) });
    expect(response.status).toBe(201);
    expect(PetView.parse(await response.json()).pet).toMatchObject({
      name: "Pip",
      species: "chick",
      rarity: "common",
      trait: "cheerful",
      stage: "baby",
      hatchedAt: NOON.toISOString(),
    });

    expect((await request("/pet/api/pet", { as: me, ...json("POST", { name: "Again" }) })).status).toBe(409);
    expect((await request("/pet/api/pet", { as: uniqueLogin(), ...json("POST", { name: " " }) })).status).toBe(400);
  });
});

describe("interactions", () => {
  test("need a pet", async () => {
    expect((await interact(uniqueLogin(), "pet")).status).toBe(404);
  });

  test("spend treats earned by walking, and refuse with the reason", async () => {
    const me = uniqueLogin();
    await hatch(me, new Date("2026-09-21T08:00:00Z"));

    const refused = await interact(me, "treat");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "No treats left: one per 2,500 steps" });

    await walk(me, [{ date: "2026-09-21", steps: 5_000 }], NOON);
    const fed = await interact(me, "treat");
    expect(fed.status).toBe(200);
    expect(PetView.parse(await fed.json()).pet).toMatchObject({ treats: 1, bars: { mood: 70 } });
    expect((await stateOf(me)).pet?.treats).toBe(1);
  });

  test("never spend the same treat twice, however fast the taps", async () => {
    const me = uniqueLogin();
    await hatch(me, new Date("2026-09-21T08:00:00Z"));
    await walk(me, [{ date: "2026-09-21", steps: 2_600 }], NOON);

    const statuses = (await Promise.all([interact(me, "treat"), interact(me, "treat")])).map((r) => r.status);

    expect(statuses.toSorted()).toEqual([200, 409]);
    expect((await stateOf(me)).pet?.treats).toBe(0);
  });

  test("reject an unknown kind", async () => {
    const me = uniqueLogin();
    await hatch(me, NOON);
    expect((await interact(me, "tickle")).status).toBe(400);
  });
});

describe("settings", () => {
  test("rename the pet and set a goal that counts from today", async () => {
    const me = uniqueLogin();
    await hatch(me, new Date("2026-09-20T08:00:00Z"));
    await walk(me, [{ date: "2026-09-20", steps: 9_000 }], NOON);

    const response = await request("/pet/api/pet", { as: me, ...json("PATCH", { name: "Mochi", stepGoal: 10_000 }) });

    const view = PetView.parse(await response.json());
    expect(view.pet?.name).toBe("Mochi");
    expect(view.today.goal).toBe(10_000);
    expect(view.pet?.streak).toBe(1);
  });

  test("only wear what has been unlocked", async () => {
    const me = uniqueLogin();
    await hatch(me, new Date("2026-09-17T08:00:00Z"));

    const locked = await request("/pet/api/pet", { as: me, ...json("PATCH", { accessory: "bow" }) });
    expect(locked.status).toBe(400);

    await walk(
      me,
      ["2026-09-17", "2026-09-18", "2026-09-19"].map((date) => ({ date, steps: 8_000 })),
      NOON,
    );
    const worn = await request("/pet/api/pet", { as: me, ...json("PATCH", { accessory: "bow" }) });
    expect(PetView.parse(await worn.json()).pet?.accessory).toBe("bow");
    const off = await request("/pet/api/pet", { as: me, ...json("PATCH", { accessory: null }) });
    expect(PetView.parse(await off.json()).pet?.accessory).toBeNull();
  });

  test("refuse an empty or out-of-range update", async () => {
    const me = uniqueLogin();
    await hatch(me, NOON);
    for (const update of [{}, { stepGoal: 500 }, { stepGoal: 8_000.5 }, { name: "" }]) {
      expect((await request("/pet/api/pet", { as: me, ...json("PATCH", update) })).status).toBe(400);
    }
  });
});

describe("history", () => {
  test("lists the last fortnight with the days that fed the pet", async () => {
    const me = uniqueLogin();
    await hatch(me, new Date("2026-09-19T08:00:00Z"));
    await walk(
      me,
      [
        { date: "2026-09-18", steps: 12_000 },
        { date: "2026-09-19", steps: 8_000 },
        { date: "2026-09-20", steps: 7_999 },
      ],
      NOON,
    );

    const history = History.parse(await (await request("/pet/api/history", { as: me })).json());

    expect(history).toHaveLength(14);
    expect(history.slice(-4)).toEqual([
      { date: "2026-09-18", steps: 12_000, goal: 8_000, fed: null },
      { date: "2026-09-19", steps: 8_000, goal: 8_000, fed: true },
      { date: "2026-09-20", steps: 7_999, goal: 8_000, fed: false },
      { date: "2026-09-21", steps: null, goal: 8_000, fed: false },
    ]);
  });
});
