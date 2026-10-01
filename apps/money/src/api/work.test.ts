import { describe, expect, test } from "bun:test";
import { drainJobs, type Notification } from "@apps/core";
import { uniqueLogin } from "@apps/core/testing";
import { eq } from "drizzle-orm";
import { createMoneyTestContext, entry, fakeBank, fakePrices, NOW, TODAY } from "../../test/support";
import { moneyDb } from "./db";
import type { PriceSource } from "./prices";
import { accounts, balances, bankLinks, connections, holdings, portfolios, securities } from "./schema";
import { createMoneyWork } from "./work";

const context = createMoneyTestContext();
const db = moneyDb(context.sql);

const HSBC = fakeBank([
  {
    uid: "uid-current",
    identificationHash: "hash-current",
    name: "Current",
    currency: "GBP",
    balance: 5000,
    transactions: [entry("2026-09-20", -100, "TEA", "e1")],
  },
]);

const setup = (prices: PriceSource = fakePrices().prices) => {
  const sent: { owner: string; notification: Notification }[] = [];
  const work = createMoneyWork({
    db,
    bank: HSBC.bank,
    prices,
    queue: context.jobs,
    notifier: (owner) => ({ send: async (notification) => void sent.push({ owner, notification }) }),
    publicUrl: "https://apps.example",
    now: () => NOW,
  });
  return { work, sent, drain: () => drainJobs(context.sql, work.jobs) };
};

const addConnection = async (owner: string, validUntil: string) => {
  const [connection] = await db
    .insert(connections)
    .values({ owner, institution: "HSBC", country: "GB", sessionId: "session", validUntil: new Date(validUntil) })
    .returning();
  const [account] = await db.insert(accounts).values({ owner, name: "HSBC Current", kind: "cash" }).returning();
  if (connection === undefined || account === undefined) {
    throw new Error("insert returned nothing");
  }
  await db.insert(bankLinks).values({
    accountId: account.id,
    connectionId: connection.id,
    identificationHash: "hash-current",
    uid: "uid-current",
  });
  return { connection, account };
};

const addPortfolio = async (cash: number, held: readonly { code: string; units: number }[]) => {
  const [account] = await db
    .insert(accounts)
    .values({ owner: uniqueLogin(), name: "ISA", kind: "investment" })
    .returning();
  if (account === undefined) {
    throw new Error("insert returned nothing");
  }
  await db.insert(portfolios).values({ accountId: account.id, cash, importedOn: "2026-09-18" });
  if (held.length > 0) {
    await db.insert(holdings).values(held.map((holding) => ({ ...holding, accountId: account.id, cost: null })));
  }
  return account;
};

const balancesOf = (accountId: string) =>
  db
    .select({ date: balances.date, amount: balances.amount })
    .from(balances)
    .where(eq(balances.accountId, accountId))
    .orderBy(balances.date);

describe("money.sync-banks", () => {
  test("syncs every live connection, and tells an owner once that a consent is about to lapse", async () => {
    const [lapsing, healthy, lapsed] = [uniqueLogin(), uniqueLogin(), uniqueLogin()];
    const soon = await addConnection(lapsing, "2026-09-25T09:00:00Z");
    const later = await addConnection(healthy, "2026-12-01T09:00:00Z");
    const gone = await addConnection(lapsed, "2026-09-20T09:00:00Z");
    const { work, sent, drain } = setup();

    await context.jobs.enqueue(work.definitions.syncBanks, {});
    await drain();
    await context.jobs.enqueue(work.definitions.syncBanks, {});
    await drain();

    expect(sent.filter(({ owner }) => owner !== lapsed)).toEqual([
      {
        owner: lapsing,
        notification: {
          title: "Renew your HSBC link",
          message: "Its consent runs out on 25 September; after that nothing new is read.",
          clickUrl: "https://apps.example/money/accounts",
          tag: soon.connection.id,
        },
      },
    ]);
    expect(sent.filter(({ owner }) => owner === lapsed)).toHaveLength(1);
    expect(await balancesOf(soon.account.id)).toContainEqual({ date: TODAY, amount: 5000 });
    expect(await balancesOf(later.account.id)).toContainEqual({ date: TODAY, amount: 5000 });
    expect(await balancesOf(gone.account.id)).toEqual([]);
  });
});

describe("money.reprice", () => {
  test("prices held securities that have a symbol, then values every portfolio at today's prices", async () => {
    await db.insert(securities).values([
      { code: "OCDO", name: "Ocado", symbol: "OCDO:LSE", price: 250, pricedOn: "2026-09-18" },
      { code: "B59G4Q7", name: "Vanguard", symbol: null, price: 92477, pricedOn: "2026-09-18" },
      { code: "GONE", name: "Delisted", symbol: "GONE:LSE", price: 10, pricedOn: "2026-09-18" },
      { code: "SOLD", name: "Sold", symbol: "SOLD:LSE", price: 99, pricedOn: "2026-09-18" },
    ]);
    const isa = await addPortfolio(25000, [
      { code: "OCDO", units: 1000 },
      { code: "B59G4Q7", units: 10.5 },
      { code: "GONE", units: 3 },
    ]);
    const empty = await addPortfolio(700, []);
    const market = fakePrices({ "OCDO:LSE": 255.6, "SOLD:LSE": 1 });
    const { work, drain } = setup(market.prices);

    await context.jobs.enqueue(work.definitions.reprice, {});
    await drain();

    expect(market.quoted.toSorted()).toEqual(["GONE:LSE", "OCDO:LSE"]);
    expect(await db.select().from(securities).orderBy(securities.code)).toEqual([
      { code: "B59G4Q7", name: "Vanguard", symbol: null, price: 92477, pricedOn: "2026-09-18" },
      { code: "GONE", name: "Delisted", symbol: "GONE:LSE", price: 10, pricedOn: "2026-09-18" },
      { code: "OCDO", name: "Ocado", symbol: "OCDO:LSE", price: 255.6, pricedOn: TODAY },
      { code: "SOLD", name: "Sold", symbol: "SOLD:LSE", price: 99, pricedOn: "2026-09-18" },
    ]);
    expect(await balancesOf(isa.id)).toEqual([{ date: TODAY, amount: 25000 + 255600 + 971009 + 30 }]);
    expect(await balancesOf(empty.id)).toEqual([{ date: TODAY, amount: 700 }]);
  });
});

describe("money.resolve-security", () => {
  test("leaves a security unmatched when no sterling listing's price agrees", async () => {
    await db
      .insert(securities)
      .values({ code: "B59G4Q7", name: "Vanguard World", price: 92477, pricedOn: "2026-09-18" });
    const market = fakePrices(
      { "GB00B5B74F71:GBP": 61250 },
      {
        B59G4Q7: [{ symbol: "BUKK:JKT", name: "Bukaka Teknik Utama" }],
        "Vanguard World": [{ symbol: "GB00B5B74F71:GBP", name: "Vanguard World Inc" }],
      },
    );
    const { work, drain } = setup(market.prices);

    await work.resolveSoon(["B59G4Q7"]);
    await drain();

    expect(market.searched).toEqual(["B59G4Q7", "Vanguard World"]);
    expect(market.quoted).toEqual(["GB00B5B74F71:GBP"]);
    expect(await db.select().from(securities)).toEqual([
      { code: "B59G4Q7", name: "Vanguard World", symbol: null, price: 92477, pricedOn: "2026-09-18" },
    ]);
  });
});
