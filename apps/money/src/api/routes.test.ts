import { beforeEach, describe, expect, test } from "bun:test";
import { drainJobs, type RegisteredJob } from "@apps/core";
import { startTestServer, uniqueLogin } from "@apps/core/testing";
import type { z } from "zod";
import {
  createMoneyTestContext,
  entry,
  type FakeBankAccount,
  fakeBank,
  fakePrices,
  HL_HISTORY,
  HL_HOLDINGS,
  NOW,
  TODAY,
} from "../../test/support";
import {
  AccountList,
  Authorisation,
  BalanceList,
  Banking,
  HoldingList,
  ImportResult,
  InstitutionList,
  NetWorthSeries,
  Spending,
  TagList,
  Transaction,
  TransactionPage,
} from "../contract";
import { createMoneyApp } from "../module";

const CURRENT: FakeBankAccount = {
  uid: "uid-current",
  identificationHash: "hash-current",
  name: "Current",
  currency: "GBP",
  balance: 150000,
  transactions: [
    entry("2026-09-18", -2500, "TESCO STORES", "e1"),
    entry("2026-09-19", -1200, "PRET A MANGER"),
    entry("2026-09-19", -1200, "PRET A MANGER"),
    entry("2026-09-20", 200000, "SALARY", "e4"),
  ],
};
const EUROS: FakeBankAccount = { ...CURRENT, uid: "uid-eur", identificationHash: "hash-eur", currency: "EUR" };

const context = createMoneyTestContext();
const hsbc = fakeBank([CURRENT, EUROS]);
const market = fakePrices(
  { "OCDO:LSE": 255.6, "GB00B59G4Q73:GBP": 92500, "GB00B5B74F71:GBP": 61250 },
  {
    OCDO: [
      { symbol: "0OC:FRA", name: "Ocado Group PLC" },
      { symbol: "OCDO:LSE", name: "Ocado Group PLC" },
    ],
    "Vanguard FTSE Developed World ex-UK Equity": [
      { symbol: "GB00B5B74F71:GBP", name: "Vanguard FTSE Developed World ex-U.K. Equity Index Fund GBP Inc" },
      { symbol: "GB00B59G4Q73:GBP", name: "Vanguard FTSE Developed World ex-U.K. Equity Index Fund GBP Acc" },
    ],
  },
);

let jobs: readonly RegisteredJob[] = [];
const request = startTestServer((ctx) => {
  const app = createMoneyApp(ctx, { bank: hsbc.bank, prices: market.prices, now: () => NOW });
  jobs = app.jobs;
  return [app];
}, context);
const unlinked = startTestServer(
  (ctx) => [createMoneyApp(ctx, { bank: null, prices: market.prices, now: () => NOW })],
  context,
);
const drain = () => drainJobs(context.sql, jobs);

beforeEach(() => {
  hsbc.state.accounts = [CURRENT, EUROS];
  hsbc.state.failure = null;
  hsbc.asked.length = 0;
});

let me = uniqueLogin();
beforeEach(() => {
  me = uniqueLogin();
});

const send = (path: string, method = "GET", body?: unknown, as = me) =>
  request(`/money/api${path}`, {
    as,
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });

const read = async <S extends z.ZodType>(schema: S, response: Response, status = 200): Promise<z.infer<S>> => {
  expect(response.status).toBe(status);
  return schema.parse(await response.json());
};

const errorOf = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  return ((await response.json()) as { error: string }).error;
};

const addAccount = async (name: string, kind: string, as = me) => {
  const list = await read(AccountList, await send("/accounts", "POST", { name, kind }, as), 201);
  const account = list.find((other) => other.name === name);
  if (account === undefined) {
    throw new Error(`no account ${name}`);
  }
  return account;
};

/** Logs in to the fake bank as `as` and reads its accounts. */
const linkBank = async (as = me) => {
  const { url } = await read(
    Authorisation,
    await send("/bank/authorisations", "POST", { institution: { name: "HSBC", country: "GB" } }, as),
  );
  const state = new URL(url).searchParams.get("state");
  const landed = await send(`/bank/callback?code=ok&state=${state}`, "GET", undefined, as);
  await drain();
  return landed;
};

const transactionsOf = async (query = "") => read(TransactionPage, await send(`/transactions${query}`));

describe("money api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/money/api/accounts")).status).toBe(401);
    expect((await request("/money/api/bank/callback?code=ok")).status).toBe(401);
  });

  test("serves the page, and JSON 404s for unknown accounts", async () => {
    expect(await (await request("/money/")).text()).toContain('<div id="root">');
    expect((await send(`/accounts/${crypto.randomUUID()}`, "DELETE")).status).toBe(404);
    expect((await send("/accounts/nope", "DELETE")).status).toBe(404);
  });
});

describe("accounts", () => {
  test("keeps manual accounts with balances entered by hand, listing each at its latest", async () => {
    const flat = await addAccount("Flat", "property");
    const mortgage = await addAccount("Mortgage", "debt");
    expect(flat).toEqual({ id: flat.id, name: "Flat", kind: "property", feed: { kind: "manual" }, balance: null });

    await send(`/accounts/${flat.id}/balances/2026-06-30`, "PUT", { amount: 40_000_000 });
    await send(`/accounts/${mortgage.id}/balances/2026-09-01`, "PUT", { amount: -25_000_000 });
    const balances = await read(
      BalanceList,
      await send(`/accounts/${flat.id}/balances/2026-09-01`, "PUT", { amount: 41_000_000 }),
    );
    expect(balances).toEqual([
      { on: "2026-09-01", amount: 41_000_000 },
      { on: "2026-06-30", amount: 40_000_000 },
    ]);

    const list = await read(AccountList, await send("/accounts"));
    expect(list.map(({ name, balance }) => [name, balance?.amount])).toEqual([
      ["Flat", 41_000_000],
      ["Mortgage", -25_000_000],
    ]);

    const afterDelete = await read(BalanceList, await send(`/accounts/${flat.id}/balances/2026-09-01`, "DELETE"));
    expect(afterDelete).toEqual([{ on: "2026-06-30", amount: 40_000_000 }]);
  });

  test("renames, reclassifies and deletes an account", async () => {
    const pot = await addAccount("Pot", "other");

    const renamed = await read(
      AccountList,
      await send(`/accounts/${pot.id}`, "PATCH", { name: "Premium Bonds", kind: "cash" }),
    );
    expect(renamed).toEqual([expect.objectContaining({ name: "Premium Bonds", kind: "cash" })]);
    expect((await send(`/accounts/${pot.id}`, "PATCH", {})).status).toBe(400);

    expect(await read(AccountList, await send(`/accounts/${pot.id}`, "DELETE"))).toEqual([]);
  });

  test("refuses a balance dated in the future", async () => {
    const flat = await addAccount("Flat", "property");

    expect(await errorOf(await send(`/accounts/${flat.id}/balances/2026-09-22`, "PUT", { amount: 1 }), 400)).toBe(
      "A balance cannot be dated in the future",
    );
    expect((await send(`/accounts/${flat.id}/balances/${TODAY}`, "PUT", { amount: 1.5 })).status).toBe(400);
    expect((await send(`/accounts/${flat.id}/balances/yesterday`, "PUT", { amount: 1 })).status).toBe(404);
  });

  test("keeps each person's money to themselves", async () => {
    const flat = await addAccount("Flat", "property");
    await send(`/accounts/${flat.id}/balances/2026-09-01`, "PUT", { amount: 100 });
    const someone = uniqueLogin();

    expect(await read(AccountList, await send("/accounts", "GET", undefined, someone))).toEqual([]);
    expect(await read(NetWorthSeries, await send("/net-worth", "GET", undefined, someone))).toEqual([]);
    expect((await send(`/accounts/${flat.id}`, "PATCH", { name: "Mine now" }, someone)).status).toBe(404);
    expect((await send(`/accounts/${flat.id}`, "DELETE", undefined, someone)).status).toBe(404);
    expect((await send(`/accounts/${flat.id}/balances`, "GET", undefined, someone)).status).toBe(404);
    expect((await send(`/accounts/${flat.id}/balances/2026-09-02`, "PUT", { amount: 1 }, someone)).status).toBe(404);
    expect((await send("/imports/hl", "POST", { csv: HL_HISTORY, accountId: flat.id }, someone)).status).toBe(404);
  });
});

describe("net worth", () => {
  test("sums every account by kind on each day from the first balance", async () => {
    const flat = await addAccount("Flat", "property");
    const mortgage = await addAccount("Mortgage", "debt");
    await send(`/accounts/${flat.id}/balances/2026-09-18`, "PUT", { amount: 40_000_000 });
    await send(`/accounts/${mortgage.id}/balances/2026-09-20`, "PUT", { amount: -25_000_000 });

    const series = await read(NetWorthSeries, await send("/net-worth?months=3"));

    expect(series.map(({ date, byKind }) => [date, byKind.property, byKind.debt])).toEqual([
      ["2026-09-18", 40_000_000, 0],
      ["2026-09-19", 40_000_000, 0],
      ["2026-09-20", 40_000_000, -25_000_000],
      ["2026-09-21", 40_000_000, -25_000_000],
    ]);
    expect((await send("/net-worth?months=0")).status).toBe(400);
  });
});

describe("Hargreaves Lansdown exports", () => {
  test("a holdings export makes the account it names, worth its holdings and cash on the day it was made", async () => {
    const result = await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HOLDINGS }));
    expect(result).toMatchObject({ kind: "holdings", holdings: 2 });

    expect(await read(AccountList, await send("/accounts"))).toEqual([
      {
        id: result.accountId,
        name: "HL Stocks & Shares ISA",
        kind: "investment",
        feed: { kind: "portfolio", cash: 25000, importedOn: "2026-09-18" },
        balance: { on: "2026-09-18", amount: 1_249_770 },
      },
    ]);
    expect(await read(HoldingList, await send("/holdings"))).toEqual([
      {
        accountId: result.accountId,
        code: "OCDO",
        name: "Ocado Group plc Ordinary 2p",
        units: 1000,
        price: 253.761,
        pricedOn: "2026-09-18",
        value: 253761,
        cost: 300000,
        symbol: null,
      },
      expect.objectContaining({ code: "B59G4Q7", units: 10.5, price: 92477, value: 971009, cost: 800000 }),
    ]);
  });

  test("matches each security to the FT listing whose price agrees, then values the account at today's prices", async () => {
    const { accountId } = await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HOLDINGS }));
    await drain();

    const holdings = await read(HoldingList, await send("/holdings"));
    expect(holdings.map(({ code, symbol, price, pricedOn }) => [code, symbol, price, pricedOn])).toEqual([
      ["OCDO", "OCDO:LSE", 255.6, TODAY],
      ["B59G4Q7", "GB00B59G4Q73:GBP", 92500, TODAY],
    ]);
    expect(await read(BalanceList, await send(`/accounts/${accountId}/balances`))).toEqual([
      { on: TODAY, amount: 25000 + 255600 + 971250 },
      { on: "2026-09-18", amount: 1_249_770 },
    ]);
  });

  test("a later holdings export replaces what the same account held", async () => {
    const first = await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HOLDINGS }));
    const sold = HL_HOLDINGS.split("\n")
      .filter((line) => !line.startsWith("OCDO"))
      .join("\n")
      .replace("18-09-2026", "20-09-2026")
      .replace('"12,497.70"', '"9,960.09"');

    const second = await read(ImportResult, await send("/imports/hl", "POST", { csv: sold }));

    expect(second).toEqual({ kind: "holdings", accountId: first.accountId, holdings: 1 });
    expect((await read(HoldingList, await send("/holdings"))).map((holding) => holding.code)).toEqual(["B59G4Q7"]);
    expect(await read(AccountList, await send("/accounts"))).toEqual([
      expect.objectContaining({
        feed: { kind: "portfolio", cash: 25000, importedOn: "2026-09-20" },
        balance: { on: "2026-09-20", amount: 996_009 },
      }),
    ]);
  });

  test("a transaction history adds the rows not already there, twins included", async () => {
    const { accountId } = await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HOLDINGS }));

    expect(await errorOf(await send("/imports/hl", "POST", { csv: HL_HISTORY }), 400)).toBe(
      "Choose the account this transaction history belongs to",
    );
    expect(await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HISTORY, accountId }))).toEqual({
      kind: "transactions",
      accountId,
      added: 4,
    });
    expect(await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HISTORY, accountId }))).toMatchObject({
      added: 0,
    });

    const { transactions } = await transactionsOf();
    expect(transactions.map(({ bookedOn, amount, description }) => [bookedOn, amount, description])).toEqual(
      expect.arrayContaining([
        ["2026-09-18", -300000, "Ocado Group plc Ordinary 2p 1000 @ 298.805"],
        ["2026-09-01", -375, "Management fee"],
        ["2026-09-01", -375, "Management fee"],
        ["2026-08-28", 400000, "Faster payment receipt"],
      ]),
    );
    expect(transactions).toHaveLength(4);
  });

  test("refuses a file that is not an export, and a balance set by hand on a portfolio", async () => {
    const { accountId } = await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HOLDINGS }));
    const flat = await addAccount("Flat", "property");

    expect(await errorOf(await send("/imports/hl", "POST", { csv: "Date,Amount\n1,2\n" }), 400)).toContain(
      "Not a Hargreaves Lansdown export",
    );
    expect(await errorOf(await send("/imports/hl", "POST", { csv: HL_HOLDINGS, accountId: flat.id }), 409)).toBe(
      '"Flat" does not hold investments from broker exports',
    );
    expect(await errorOf(await send(`/accounts/${accountId}/balances/${TODAY}`, "PUT", { amount: 1 }), 409)).toBe(
      '"HL Stocks & Shares ISA" is kept up to date by its broker exports',
    );
  });

  test("sets a security's symbol by hand once FT prices it, and stops repricing it on null", async () => {
    const { accountId } = await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HOLDINGS }));

    expect(await errorOf(await send("/securities/OCDO", "PUT", { symbol: "NOPE:LSE" }), 400)).toBe(
      'FT Markets has no sterling price for "NOPE:LSE"',
    );
    const priced = await read(HoldingList, await send("/securities/OCDO", "PUT", { symbol: "OCDO:LSE" }));
    expect(priced[0]).toMatchObject({ symbol: "OCDO:LSE", price: 255.6, pricedOn: TODAY, value: 255600 });
    expect((await read(BalanceList, await send(`/accounts/${accountId}/balances`)))[0]).toEqual({
      on: TODAY,
      amount: 25000 + 255600 + 971009,
    });

    const cleared = await read(HoldingList, await send("/securities/OCDO", "PUT", { symbol: null }));
    expect(cleared[0]).toMatchObject({ symbol: null, price: 255.6 });
    expect((await send("/securities/OCDO", "PUT", { symbol: "OCDO:LSE" }, uniqueLogin())).status).toBe(404);
  });
});

describe("banks", () => {
  test("says when linking is not configured", async () => {
    const as = uniqueLogin();

    expect(await read(Banking, await unlinked("/money/api/banking", { as }))).toEqual({
      available: false,
      connections: [],
    });
    expect((await unlinked("/money/api/bank/institutions", { as })).status).toBe(503);
  });

  test("links a bank through its own login, then reads its sterling accounts", async () => {
    expect(await read(InstitutionList, await send("/bank/institutions"))).toEqual([{ name: "HSBC", country: "GB" }]);

    const landed = await linkBank();

    expect(landed.status).toBe(303);
    expect(landed.headers.get("Location")).toBe("/money/accounts?linked=1");
    const banking = await read(Banking, await send("/banking"));
    expect(banking).toEqual({
      available: true,
      connections: [
        {
          id: expect.any(String),
          institution: "HSBC",
          country: "GB",
          validUntil: "2026-12-20T11:00:00.000Z",
          lastSyncedAt: NOW.toISOString(),
          lastError: null,
        },
      ],
    });
    expect(await read(AccountList, await send("/accounts"))).toEqual([
      {
        id: expect.any(String),
        name: "HSBC Current",
        kind: "cash",
        feed: { kind: "bank", connectionId: banking.connections[0]?.id ?? "", institution: "HSBC" },
        balance: { on: TODAY, amount: 150000 },
      },
    ]);
    expect(hsbc.asked).toEqual([{ uid: "uid-current", since: { kind: "everything" } }]);
  });

  test("records each booked transaction once, and works past balances back from today's", async () => {
    await linkBank();
    const [connection] = (await read(Banking, await send("/banking"))).connections;
    const [account] = await read(AccountList, await send("/accounts"));

    hsbc.state.accounts = [
      { ...CURRENT, balance: 149000, transactions: [...CURRENT.transactions, entry(TODAY, -1000, "BOOTS", "e5")] },
    ];
    expect((await send(`/connections/${connection?.id}/sync`, "POST")).status).toBe(202);
    await drain();

    expect(hsbc.asked.at(-1)).toEqual({ uid: "uid-current", since: { kind: "from", date: "2026-09-10" } });
    const { transactions } = await transactionsOf();
    expect(transactions.map(({ bookedOn, amount, description }) => [bookedOn, amount, description])).toEqual([
      [TODAY, -1000, "BOOTS"],
      ["2026-09-20", 200000, "SALARY"],
      ["2026-09-19", -1200, "PRET A MANGER"],
      ["2026-09-19", -1200, "PRET A MANGER"],
      ["2026-09-18", -2500, "TESCO STORES"],
    ]);
    expect(await read(BalanceList, await send(`/accounts/${account?.id}/balances`))).toEqual([
      { on: TODAY, amount: 149000 },
      { on: "2026-09-20", amount: 150000 },
      { on: "2026-09-19", amount: -50000 },
      { on: "2026-09-18", amount: -47600 },
    ]);
  });

  test("renewing a consent keeps the accounts it already feeds", async () => {
    await linkBank();
    const before = await read(AccountList, await send("/accounts"));

    hsbc.state.accounts = [{ ...CURRENT, uid: "uid-renewed" }];
    await linkBank();

    expect(await read(AccountList, await send("/accounts"))).toEqual(before);
    expect((await read(Banking, await send("/banking"))).connections).toHaveLength(1);
    expect(hsbc.asked.at(-1)?.uid).toBe("uid-renewed");
    expect((await transactionsOf()).transactions).toHaveLength(4);
  });

  test("keeps the bank's refusal on the connection for its owner to see", async () => {
    await linkBank();
    const [connection] = (await read(Banking, await send("/banking"))).connections;
    const { BankError } = await import("./bank");
    hsbc.state.failure = new BankError(429, "ASPSP_RATE_LIMIT_EXCEEDED");

    await send(`/connections/${connection?.id}/sync`, "POST");
    expect(await drain()).toMatchObject({ completed: 1, retrying: 0 });

    expect((await read(Banking, await send("/banking"))).connections[0]?.lastError).toBe("ASPSP_RATE_LIMIT_EXCEEDED");
  });

  test("lands back on the accounts page with the reason when a login fails", async () => {
    const { url } = await read(
      Authorisation,
      await send("/bank/authorisations", "POST", { institution: { name: "HSBC", country: "GB" } }),
    );
    const state = new URL(url).searchParams.get("state");
    const location = async (response: Response) =>
      new URL(response.headers.get("Location") ?? "", "http://x").searchParams;

    const cancelled = await send("/bank/callback?error=access_denied&error_description=Cancelled%20at%20the%20bank");
    expect((await location(cancelled)).get("error")).toBe("Cancelled at the bank");

    const stolen = await send(`/bank/callback?code=ok&state=${state}`, "GET", undefined, uniqueLogin());
    expect((await location(stolen)).get("error")).toBe(
      "This bank login was not started here, or has already been used",
    );

    expect((await location(await send(`/bank/callback?code=ok&state=${state}`))).get("linked")).toBe("1");
    expect((await location(await send(`/bank/callback?code=ok&state=${state}`))).get("error")).toContain("already");
  });

  test("disconnecting ends the session and leaves the account, now kept by hand", async () => {
    await linkBank();
    const [connection] = (await read(Banking, await send("/banking"))).connections;

    expect((await send(`/connections/${connection?.id}`, "DELETE", undefined, uniqueLogin())).status).toBe(404);
    expect(await read(Banking, await send(`/connections/${connection?.id}`, "DELETE"))).toEqual({
      available: true,
      connections: [],
    });

    expect(hsbc.closed.at(-1)).toMatch(/^session-/);
    const [account] = await read(AccountList, await send("/accounts"));
    expect(account).toMatchObject({ name: "HSBC Current", feed: { kind: "manual" }, balance: { amount: 150000 } });
    expect((await transactionsOf()).transactions).toHaveLength(4);
  });
});

describe("transactions", () => {
  const tesco = async () => {
    const found = (await transactionsOf("?q=tesco")).transactions[0];
    if (found === undefined) {
      throw new Error("no TESCO transaction");
    }
    return found;
  };

  test("each arrives as one untagged line item for its whole amount", async () => {
    await linkBank();

    expect(await tesco()).toEqual({
      id: expect.any(String),
      accountId: expect.any(String),
      bookedOn: "2026-09-18",
      amount: -2500,
      description: "TESCO STORES",
      counterparty: null,
      items: [{ id: expect.any(String), description: "", amount: -2500, tags: [] }],
    });
  });

  test("breaks a transaction into tagged line items that must add up to it", async () => {
    await linkBank();
    const { id } = await tesco();

    expect(
      await errorOf(
        await send(`/transactions/${id}/items`, "PUT", {
          items: [
            { description: "Food", amount: -2000, tags: [] },
            { description: "Wine", amount: -600, tags: [] },
          ],
        }),
        400,
      ),
    ).toBe("The line items add up to -£26.00, but the transaction is -£25.00");

    const split = await read(
      Transaction,
      await send(`/transactions/${id}/items`, "PUT", {
        items: [
          { description: "Food", amount: -1900, tags: ["Groceries", "groceries ", "household"] },
          { description: "Wine", amount: -600, tags: ["alcohol"] },
        ],
      }),
    );
    expect(split.items.map(({ description, amount, tags }) => [description, amount, tags])).toEqual([
      ["Food", -1900, ["groceries", "household"]],
      ["Wine", -600, ["alcohol"]],
    ]);
    expect(await read(TagList, await send("/tags"))).toEqual([
      { name: "alcohol", items: 1 },
      { name: "groceries", items: 1 },
      { name: "household", items: 1 },
    ]);

    const whole = await read(
      Transaction,
      await send(`/transactions/${id}/items`, "PUT", {
        items: [{ description: "", amount: -2500, tags: ["groceries"] }],
      }),
    );
    expect(whole.items).toEqual([{ id: expect.any(String), description: "", amount: -2500, tags: ["groceries"] }]);
    expect((await send(`/transactions/${id}/items`, "PUT", { items: [] })).status).toBe(400);
    expect(
      (
        await send(
          `/transactions/${id}/items`,
          "PUT",
          { items: [{ description: "", amount: -2500, tags: [] }] },
          uniqueLogin(),
        )
      ).status,
    ).toBe(404);
  });

  test("filters by account, tag, untagged and text", async () => {
    await linkBank();
    const { id } = await tesco();
    await send(`/transactions/${id}/items`, "PUT", {
      items: [
        { description: "Food", amount: -1900, tags: ["groceries"] },
        { description: "Batteries", amount: -600, tags: [] },
      ],
    });
    const descriptions = async (query: string) =>
      (await transactionsOf(query)).transactions.map((transaction) => transaction.description);

    expect(await descriptions("?tag=groceries")).toEqual(["TESCO STORES"]);
    expect(await descriptions("?untagged=true")).toEqual(["SALARY", "PRET A MANGER", "PRET A MANGER", "TESCO STORES"]);
    expect(await descriptions("?q=batter")).toEqual(["TESCO STORES"]);
    expect(await descriptions("?q=100%25")).toEqual([]);
    expect(await descriptions(`?accountId=${crypto.randomUUID()}`)).toEqual([]);
    expect((await send("/transactions?tag=groceries&untagged=true")).status).toBe(400);
    expect((await transactionsOf()).next).toBeNull();
  });

  test("pages through a long history without missing or repeating any", async () => {
    const days = Array.from({ length: 120 }, (_, index) =>
      entry(`2026-0${1 + (index % 8)}-1${index % 5}`, -100 - index, `Shop ${index}`),
    );
    hsbc.state.accounts = [{ ...CURRENT, transactions: days }];
    await linkBank();

    const first = await transactionsOf();
    const second = await transactionsOf(`?before=${first.next}`);
    const third = await transactionsOf(`?before=${second.next}`);

    const all = [...first.transactions, ...second.transactions, ...third.transactions];
    expect([first.transactions.length, second.transactions.length, third.transactions.length]).toEqual([50, 50, 20]);
    expect(third.next).toBeNull();
    expect(new Set(all.map((transaction) => transaction.id)).size).toBe(120);
    expect(all.map((transaction) => transaction.bookedOn)).toEqual(
      all.map((transaction) => transaction.bookedOn).toSorted((a, b) => b.localeCompare(a)),
    );
  });

  test("renames and deletes tags across every line item", async () => {
    await linkBank();
    const { id } = await tesco();
    const tag = (tags: string[]) =>
      send(`/transactions/${id}/items`, "PUT", { items: [{ description: "", amount: -2500, tags }] });
    await tag(["food", "treats"]);

    expect(await errorOf(await send("/tags/food", "PATCH", { name: "Treats" }), 409)).toBe(
      'There is already a tag called "treats"',
    );
    expect(await read(TagList, await send("/tags/food", "PATCH", { name: "Groceries" }))).toEqual([
      { name: "groceries", items: 1 },
      { name: "treats", items: 1 },
    ]);
    expect((await tesco()).items[0]?.tags).toEqual(["groceries", "treats"]);

    expect(await read(TagList, await send("/tags/treats", "DELETE"))).toEqual([{ name: "groceries", items: 1 }]);
    expect((await tesco()).items[0]?.tags).toEqual(["groceries"]);
    expect((await send("/tags/treats", "DELETE")).status).toBe(404);
    expect((await send("/tags/groceries", "DELETE", undefined, uniqueLogin())).status).toBe(404);
  });
});

describe("spending", () => {
  test("totals each month's line items in cash accounts by tag, leaving investments out", async () => {
    await linkBank();
    const { accountId } = await read(ImportResult, await send("/imports/hl", "POST", { csv: HL_HOLDINGS }));
    await send("/imports/hl", "POST", { csv: HL_HISTORY, accountId });
    const [tesco] = (await transactionsOf("?q=tesco")).transactions;
    await send(`/transactions/${tesco?.id}/items`, "PUT", {
      items: [
        { description: "Food", amount: -1900, tags: ["groceries", "household"] },
        { description: "Wine", amount: -600, tags: ["alcohol"] },
      ],
    });

    expect(await read(Spending, await send("/spending?months=2"))).toEqual([
      {
        month: "2026-09",
        income: 200000,
        outgoings: -4900,
        byTag: [
          { tag: null, amount: 197600 },
          { tag: "alcohol", amount: -600 },
          { tag: "groceries", amount: -1900 },
          { tag: "household", amount: -1900 },
        ].toSorted((a, b) => a.amount - b.amount),
      },
    ]);
  });
});
