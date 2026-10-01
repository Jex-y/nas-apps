import { beforeEach } from "bun:test";
import { createTestContext } from "@apps/core/testing";
import type { Bank, BankSession, BankTransaction, Since } from "../src/api/bank";
import type { Candidate, PriceSource } from "../src/api/prices";

/** Noon on a British Summer Time Monday. */
export const NOW = new Date("2026-09-21T11:00:00Z");
export const TODAY = "2026-09-21";

/** The test database, with the money tables and money jobs emptied before each test. Call once per test file. */
export const createMoneyTestContext = () => {
  const context = createTestContext();
  beforeEach(async () => {
    await context.sql`truncate money.accounts, money.connections, money.authorisations, money.securities, money.tags cascade`;
    await context.sql`delete from jobs.jobs where name like 'money.%'`;
  });
  return context;
};

export const HL_HOLDINGS = [
  "HL Stocks & Shares ISA, , , ,",
  "Client Name:,Mr Test Person, , ,",
  "Client Number:, 1234567, , ,",
  "Spreadsheet created at,18-09-2026 19:11, , ,",
  "",
  'Stock value:,"12,247.70", , ,',
  'Total cash:,"250.00", , ,',
  'Total value:,"12,497.70", , ,',
  "",
  "Code,Stock,Units held,Price (pence),Value (£),Cost (£),Gain/loss (£),Gain/loss (%)",
  'B59G4Q7,Vanguard FTSE Developed World ex-UK Equity Index Accumulation,"10.5","92477","9,710.09","8,000.00","1,710.09","21.38"',
  'OCDO,Ocado Group plc Ordinary 2p,"1,000","253.761","2,537.61","3,000.00","-462.39","-15.41"',
  ',Totals,,,"12,247.70","11,000.00","1,247.70","11.34"',
  "",
].join("\n");

export const HL_HISTORY = [
  "HL Stocks & Shares ISA",
  "Client Name:,Mr Test Person",
  "",
  "Trade date,Settle date,Reference,Description,Unit cost (p),Quantity,Value (£)",
  '"18/09/2026","22/09/2026","B123456","Ocado Group plc Ordinary 2p 1000 @ 298.805","298.805","1000","-3,000.00"',
  '"01/09/2026","01/09/2026","MANAGE FEE","Management fee","n/a","n/a","-3.75"',
  '"01/09/2026","01/09/2026","MANAGE FEE","Management fee","n/a","n/a","-3.75"',
  '"28/08/2026","28/08/2026","FPC","Faster payment receipt","n/a","n/a","4,000.00"',
  "",
].join("\n");

export type FakeBankAccount = {
  readonly uid: string;
  readonly identificationHash: string;
  readonly name: string | null;
  readonly currency: string;
  readonly balance: number | null;
  readonly transactions: readonly BankTransaction[];
};

export const entry = (bookedOn: string, amount: number, description: string, reference: string | null = null) => ({
  reference,
  bookedOn,
  amount,
  description,
  counterparty: null,
});

/**
 * A bank holding `accounts`, whose login always succeeds with the code `ok`. `asked` records every read, and
 * `fail` makes the next reads throw.
 */
export const fakeBank = (accounts: readonly FakeBankAccount[], validUntil = new Date("2026-12-20T11:00:00Z")) => {
  const asked: { uid: string; since: Since }[] = [];
  const closed: string[] = [];
  const state: { accounts: readonly FakeBankAccount[]; failure: Error | null; sessions: number } = {
    accounts,
    failure: null,
    sessions: 0,
  };
  const account = (uid: string) => {
    if (state.failure !== null) {
      throw state.failure;
    }
    const found = state.accounts.find((other) => other.uid === uid);
    if (found === undefined) {
      throw new Error(`no account ${uid}`);
    }
    return found;
  };
  const bank: Bank = {
    institutions: async () => [{ name: "HSBC", country: "GB" }],
    authorise: async ({ state: token, redirectUrl }) => `https://bank.example/login?state=${token}&back=${redirectUrl}`,
    openSession: async (code): Promise<BankSession> => {
      if (code !== "ok") {
        throw new Error(`unexpected code ${code}`);
      }
      state.sessions += 1;
      return { sessionId: `session-${state.sessions}`, validUntil, accounts: state.accounts };
    },
    closeSession: async (sessionId) => void closed.push(sessionId),
    balance: async (uid) => account(uid).balance,
    transactions: async (uid, since) => {
      asked.push({ uid, since });
      const from = since.kind === "from" ? since.date : "";
      return account(uid).transactions.filter((transaction) => transaction.bookedOn >= from);
    },
  };
  return { bank, asked, closed, state };
};

/** A price source quoting `quotes` by symbol and finding `listings` by exact query. */
export const fakePrices = (
  quotes: Readonly<Record<string, number>> = {},
  listings: Readonly<Record<string, readonly Candidate[]>> = {},
) => {
  const quoted: string[] = [];
  const searched: string[] = [];
  const prices: PriceSource = {
    quote: async (symbol) => {
      quoted.push(symbol);
      return quotes[symbol] ?? null;
    },
    search: async (query) => {
      searched.push(query);
      return listings[query] ?? [];
    },
  };
  return { prices, quoted, searched };
};
