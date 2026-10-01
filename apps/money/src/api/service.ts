import { HttpError } from "@apps/core";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  type AccountList,
  type Authorisation,
  BANK_CALLBACK_PATH,
  type Banking,
  type CreateAccount,
  type HoldingList,
  type ImportResult,
  type Institution,
  type NetWorthSeries,
  type SplitTransaction,
  type TagList,
  type Transaction,
  type TransactionFilter,
  type UpdateAccount,
} from "../contract";
import { type Bank, BankError } from "./bank";
import { londonDate, monthsBefore } from "./calendar";
import type { MoneyDb } from "./db";
import { type HlExport, HlParseError, parseHlExport } from "./hl";
import { fingerprint, holdersOf, recordTransactions, revaluePortfolios, setBalance } from "./ingest";
import { netWorthSeries, sampleDates } from "./net-worth";
import type { PriceSource } from "./prices";
import {
  accounts,
  authorisations,
  balances,
  bankLinks,
  connections,
  holdings,
  lineItems,
  lineItemTags,
  portfolios,
  securities,
  tags,
  transactions,
} from "./schema";
import {
  type Cursor,
  readAccounts,
  readBalancePoints,
  readBalances,
  readConnections,
  readHoldings,
  readSpending,
  readTags,
  readTransaction,
  readTransactions,
} from "./views";
import type { MoneyWork } from "./work";

export type MoneyServiceDeps = {
  readonly db: MoneyDb;
  /** `null` when Enable Banking is not configured; banks then cannot be linked. */
  readonly bank: Bank | null;
  readonly prices: PriceSource;
  readonly work: MoneyWork;
  readonly publicUrl: string;
  readonly now: () => Date;
};

type AccountRow = typeof accounts.$inferSelect;

const PAGE_SIZE = 50;
/** The most points a net worth series is sampled down to. */
const SERIES_POINTS = 366;
const QUOTE_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

const pounds = (pence: number) =>
  (pence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });

/**
 * Everything someone can do with their money, shared by the HTTP API and the MCP server. Refusals are
 * {@link HttpError}s saying why. Nobody can see or touch another's accounts.
 */
export const createMoneyService = ({ db, bank, prices, work, publicUrl, now }: MoneyServiceDeps) => {
  const today = () => londonDate(now());

  const ownAccount = async (owner: string, accountId: string): Promise<AccountRow> => {
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.owner, owner)));
    if (account === undefined) {
      throw new HttpError(404, "Not found");
    }
    return account;
  };

  const feedOf = async (account: AccountRow): Promise<"bank" | "portfolio" | "manual"> => {
    const [link] = await db
      .select({ id: bankLinks.accountId })
      .from(bankLinks)
      .where(eq(bankLinks.accountId, account.id));
    const [portfolio] = await db
      .select({ id: portfolios.accountId })
      .from(portfolios)
      .where(eq(portfolios.accountId, account.id));
    return link !== undefined ? "bank" : portfolio !== undefined ? "portfolio" : "manual";
  };

  const requireManual = async (account: AccountRow) => {
    const feed = await feedOf(account);
    if (feed !== "manual") {
      throw new HttpError(
        409,
        `"${account.name}" is kept up to date by its ${feed === "bank" ? "bank" : "broker exports"}`,
      );
    }
  };

  const requireBank = (): Bank => {
    if (bank === null) {
      throw new HttpError(
        503,
        "Bank linking is not configured: set ENABLE_BANKING_APP_ID and ENABLE_BANKING_PRIVATE_KEY",
      );
    }
    return bank;
  };

  const ownConnection = async (owner: string, connectionId: string) => {
    const [connection] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.owner, owner)));
    if (connection === undefined) {
      throw new HttpError(404, "Not found");
    }
    return connection;
  };

  const ownTag = async (owner: string, name: string) => {
    const [tag] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.owner, owner), eq(tags.name, name)));
    if (tag === undefined) {
      throw new HttpError(404, "Not found");
    }
    return tag;
  };

  /** The portfolio a holdings export belongs to: the one chosen, else the one named as the file is, else a new one. */
  const portfolioFor = async (owner: string, accountId: string | null, name: string): Promise<AccountRow> => {
    if (accountId !== null) {
      const account = await ownAccount(owner, accountId);
      if ((await feedOf(account)) !== "portfolio") {
        throw new HttpError(409, `"${account.name}" does not hold investments from broker exports`);
      }
      return account;
    }
    const [existing] = await db
      .select({ account: accounts })
      .from(accounts)
      .innerJoin(portfolios, eq(portfolios.accountId, accounts.id))
      .where(and(eq(accounts.owner, owner), eq(accounts.name, name)));
    if (existing !== undefined) {
      return existing.account;
    }
    const [created] = await db.insert(accounts).values({ owner, name, kind: "investment" }).returning();
    if (created === undefined) {
      throw new Error("insert returned nothing");
    }
    return created;
  };

  const importHoldings = async (
    owner: string,
    accountId: string | null,
    file: HlExport & { kind: "holdings" },
  ): Promise<ImportResult> => {
    const asOf = file.asOf ?? today();
    const account = await portfolioFor(owner, accountId, file.account);
    const unmatched = await db.transaction(async (tx) => {
      await tx
        .insert(portfolios)
        .values({ accountId: account.id, cash: file.cash, importedOn: asOf })
        .onConflictDoUpdate({ target: portfolios.accountId, set: { cash: file.cash, importedOn: asOf } });
      await tx.delete(holdings).where(eq(holdings.accountId, account.id));
      if (file.holdings.length > 0) {
        // An older export must not put back a price that has since been refreshed.
        await tx
          .insert(securities)
          .values(file.holdings.map(({ code, name, price }) => ({ code, name, price, pricedOn: asOf })))
          .onConflictDoUpdate({
            target: securities.code,
            set: { name: sql`excluded.name`, price: sql`excluded.price`, pricedOn: sql`excluded.priced_on` },
            setWhere: sql`excluded.priced_on >= ${securities.pricedOn}`,
          });
        await tx
          .insert(holdings)
          .values(file.holdings.map(({ code, units, cost }) => ({ accountId: account.id, code, units, cost })));
      }
      const worth = file.holdings.reduce((sum, { units, price }) => sum + Math.round(units * price), file.cash);
      await setBalance(tx, account.id, asOf, worth);
      return file.holdings.length === 0
        ? []
        : tx
            .select({ code: securities.code })
            .from(securities)
            .where(
              and(
                isNull(securities.symbol),
                inArray(
                  securities.code,
                  file.holdings.map(({ code }) => code),
                ),
              ),
            );
    });
    await work.resolveSoon(unmatched.map(({ code }) => code));
    return { kind: "holdings", accountId: account.id, holdings: file.holdings.length };
  };

  const importHistory = async (
    owner: string,
    accountId: string | null,
    file: HlExport & { kind: "transactions" },
  ): Promise<ImportResult> => {
    if (accountId === null) {
      throw new HttpError(400, "Choose the account this transaction history belongs to");
    }
    const account = await ownAccount(owner, accountId);
    if ((await feedOf(account)) === "bank") {
      throw new HttpError(409, `"${account.name}" gets its transactions from its bank`);
    }
    const rows = fingerprint(
      file.transactions,
      (row) => `${row.tradedOn}|${row.reference}|${row.description}|${row.amount}`,
    ).map(({ row, fingerprint }) => ({
      reference: fingerprint,
      bookedOn: row.tradedOn,
      amount: row.amount,
      description: row.description,
      counterparty: null,
    }));
    const added = await recordTransactions(db, account.id, rows);
    return { kind: "transactions", accountId: account.id, added };
  };

  return {
    accounts: (owner: string): Promise<AccountList> => readAccounts(db, owner),

    /** Adds an account whose balance is entered by hand. */
    createAccount: async (owner: string, input: CreateAccount): Promise<AccountList> => {
      await db.insert(accounts).values({ ...input, owner });
      return readAccounts(db, owner);
    },

    updateAccount: async (owner: string, accountId: string, update: UpdateAccount): Promise<AccountList> => {
      const account = await ownAccount(owner, accountId);
      await db.update(accounts).set(update).where(eq(accounts.id, account.id));
      return readAccounts(db, owner);
    },

    /** Deletes an account with its balances, transactions and holdings. */
    deleteAccount: async (owner: string, accountId: string): Promise<AccountList> => {
      const account = await ownAccount(owner, accountId);
      await db.delete(accounts).where(eq(accounts.id, account.id));
      return readAccounts(db, owner);
    },

    balances: async (owner: string, accountId: string) => readBalances(db, (await ownAccount(owner, accountId)).id),

    /** Records what a manual account was worth at the end of `date`. */
    setBalance: async (owner: string, accountId: string, date: string, amount: number) => {
      const account = await ownAccount(owner, accountId);
      await requireManual(account);
      if (date > today()) {
        throw new HttpError(400, "A balance cannot be dated in the future");
      }
      await setBalance(db, account.id, date, amount);
      return readBalances(db, account.id);
    },

    deleteBalance: async (owner: string, accountId: string, date: string) => {
      const account = await ownAccount(owner, accountId);
      await requireManual(account);
      await db.delete(balances).where(and(eq(balances.accountId, account.id), eq(balances.date, date)));
      return readBalances(db, account.id);
    },

    /** The last `months` months of net worth, from the first balance known if that is later. */
    netWorth: async (owner: string, months: number): Promise<NetWorthSeries> => {
      const points = await readBalancePoints(db, owner);
      const first = points.reduce<string | null>(
        (earliest, { date }) => (earliest === null || date < earliest ? date : earliest),
        null,
      );
      if (first === null) {
        return [];
      }
      const start = monthsBefore(today(), months);
      return netWorthSeries(points, sampleDates(first > start ? first : start, today(), SERIES_POINTS));
    },

    transactions: (owner: string, filter: TransactionFilter, before: Cursor | null) =>
      readTransactions(db, owner, filter, before, PAGE_SIZE),

    /** Replaces a transaction's line items and their tags, making any tag not seen before. */
    splitTransaction: async (
      owner: string,
      transactionId: string,
      { items }: SplitTransaction,
    ): Promise<Transaction> => {
      const [row] = await db
        .select({ id: transactions.id, amount: transactions.amount })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(and(eq(transactions.id, transactionId), eq(accounts.owner, owner)));
      if (row === undefined) {
        throw new HttpError(404, "Not found");
      }
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      if (total !== row.amount) {
        throw new HttpError(
          400,
          `The line items add up to ${pounds(total)}, but the transaction is ${pounds(row.amount)}`,
        );
      }
      await db.transaction(async (tx) => {
        const names = [...new Set(items.flatMap((item) => item.tags))];
        if (names.length > 0) {
          await tx
            .insert(tags)
            .values(names.map((name) => ({ owner, name })))
            .onConflictDoNothing();
        }
        const known =
          names.length === 0
            ? []
            : await tx
                .select({ id: tags.id, name: tags.name })
                .from(tags)
                .where(and(eq(tags.owner, owner), inArray(tags.name, names)));
        const tagId = new Map(known.map((tag) => [tag.name, tag.id]));

        await tx.delete(lineItems).where(eq(lineItems.transactionId, row.id));
        const inserted = await tx
          .insert(lineItems)
          .values(
            items.map(({ description, amount }, position) => ({
              transactionId: row.id,
              position,
              description,
              amount,
            })),
          )
          .returning({ id: lineItems.id, position: lineItems.position });
        const links = inserted.flatMap(({ id, position }) =>
          [...new Set(items[position]?.tags ?? [])].flatMap((name) => {
            const tag = tagId.get(name);
            return tag === undefined ? [] : [{ lineItemId: id, tagId: tag }];
          }),
        );
        if (links.length > 0) {
          await tx.insert(lineItemTags).values(links);
        }
      });
      const transaction = await readTransaction(db, row.id);
      if (transaction === undefined) {
        throw new Error("transaction vanished");
      }
      return transaction;
    },

    tags: (owner: string): Promise<TagList> => readTags(db, owner),

    renameTag: async (owner: string, name: string, to: string): Promise<TagList> => {
      const tag = await ownTag(owner, name);
      const [taken] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.owner, owner), eq(tags.name, to)));
      if (taken !== undefined && taken.id !== tag.id) {
        throw new HttpError(409, `There is already a tag called "${to}"`);
      }
      await db.update(tags).set({ name: to }).where(eq(tags.id, tag.id));
      return readTags(db, owner);
    },

    /** Deletes a tag, taking it off every line item. */
    deleteTag: async (owner: string, name: string): Promise<TagList> => {
      const tag = await ownTag(owner, name);
      await db.delete(tags).where(eq(tags.id, tag.id));
      return readTags(db, owner);
    },

    /** Income, outgoings and net by tag for this month and the `months - 1` before it. */
    spending: (owner: string, months: number) =>
      readSpending(db, owner, `${monthsBefore(today(), months - 1).slice(0, 7)}-01`),

    holdings: (owner: string): Promise<HoldingList> => readHoldings(db, owner),

    /**
     * Sets the FT Markets symbol a security is repriced from, pricing it there and then to prove the symbol is good;
     * `null` stops repricing it.
     */
    setSymbol: async (owner: string, code: string, symbol: string | null): Promise<HoldingList> => {
      const held = await db
        .select({ accountId: holdings.accountId })
        .from(holdings)
        .innerJoin(accounts, eq(accounts.id, holdings.accountId))
        .where(and(eq(holdings.code, code), eq(accounts.owner, owner)));
      if (held.length === 0) {
        throw new HttpError(404, "Not found");
      }
      if (symbol === null) {
        await db.update(securities).set({ symbol: null }).where(eq(securities.code, code));
        return readHoldings(db, owner);
      }
      const price = await prices.quote(symbol, AbortSignal.timeout(QUOTE_TIMEOUT_MS));
      if (price === null) {
        throw new HttpError(400, `FT Markets has no sterling price for "${symbol}"`);
      }
      await db.update(securities).set({ symbol, price, pricedOn: today() }).where(eq(securities.code, code));
      await revaluePortfolios(db, today(), await holdersOf(db, code));
      return readHoldings(db, owner);
    },

    /** Takes a Hargreaves Lansdown CSV export: an account's holdings, which replace what it held, or its history. */
    importHl: async (owner: string, csv: string, accountId: string | null): Promise<ImportResult> => {
      const file = (() => {
        try {
          return parseHlExport(csv);
        } catch (error) {
          throw error instanceof HlParseError ? new HttpError(400, error.message) : error;
        }
      })();
      return file.kind === "holdings" ? importHoldings(owner, accountId, file) : importHistory(owner, accountId, file);
    },

    banking: async (owner: string): Promise<Banking> => ({
      available: bank !== null,
      connections: await readConnections(db, owner),
    }),

    institutions: (country: string): Promise<readonly Institution[]> => requireBank().institutions(country),

    /** Starts a bank login, answering with the bank's page to send the browser to. */
    startAuthorisation: async (owner: string, institution: Institution): Promise<Authorisation> => {
      const bank = requireBank();
      await db.delete(authorisations).where(lt(authorisations.createdAt, new Date(now().getTime() - DAY_MS)));
      const [pending] = await db
        .insert(authorisations)
        .values({ owner, institution: institution.name, country: institution.country })
        .returning({ state: authorisations.state });
      if (pending === undefined) {
        throw new Error("insert returned nothing");
      }
      const url = await bank.authorise({
        institution,
        state: pending.state,
        redirectUrl: `${publicUrl}${BANK_CALLBACK_PATH}`,
      });
      return { url };
    },

    /**
     * Finishes a bank login the same person started: keeps the session, adds any sterling account not seen before,
     * and reads them all. Renewing a consent keeps the accounts it already feeds.
     */
    completeAuthorisation: async (owner: string, state: string, code: string): Promise<void> => {
      const bank = requireBank();
      const [pending] = await db
        .delete(authorisations)
        .where(and(eq(authorisations.state, state), eq(authorisations.owner, owner)))
        .returning();
      if (pending === undefined) {
        throw new HttpError(400, "This bank login was not started here, or has already been used");
      }
      const session = await bank.openSession(code).catch((error: unknown) => {
        throw error instanceof BankError ? new HttpError(502, error.message) : error;
      });
      const connectionId = await db.transaction(async (tx) => {
        const renewed = { sessionId: session.sessionId, validUntil: session.validUntil };
        const [connection] = await tx
          .insert(connections)
          .values({ owner, institution: pending.institution, country: pending.country, ...renewed })
          .onConflictDoUpdate({
            target: [connections.owner, connections.institution, connections.country],
            set: { ...renewed, lastError: null, expiryWarnedAt: null },
          })
          .returning({ id: connections.id });
        if (connection === undefined) {
          throw new Error("insert returned nothing");
        }
        for (const linked of session.accounts.filter((account) => account.currency === "GBP")) {
          const known = await tx
            .update(bankLinks)
            .set({ uid: linked.uid })
            .where(
              and(
                eq(bankLinks.connectionId, connection.id),
                eq(bankLinks.identificationHash, linked.identificationHash),
              ),
            )
            .returning({ accountId: bankLinks.accountId });
          if (known.length > 0) {
            continue;
          }
          const [account] = await tx
            .insert(accounts)
            .values({ owner, name: `${pending.institution} ${linked.name ?? "account"}`, kind: "cash" })
            .returning({ id: accounts.id });
          if (account === undefined) {
            throw new Error("insert returned nothing");
          }
          await tx.insert(bankLinks).values({
            accountId: account.id,
            connectionId: connection.id,
            identificationHash: linked.identificationHash,
            uid: linked.uid,
          });
        }
        return connection.id;
      });
      await work.syncSoon(connectionId);
    },

    /** Reads a connection's accounts now rather than at the next scheduled sync. */
    syncConnection: async (owner: string, connectionId: string): Promise<void> => {
      await work.syncSoon((await ownConnection(owner, connectionId)).id);
    },

    /** Withdraws a consent. Its accounts and their history stay, from then on kept by hand. */
    disconnect: async (owner: string, connectionId: string): Promise<Banking> => {
      const connection = await ownConnection(owner, connectionId);
      // A session the bank has already ended cannot be closed, and is no reason to keep the connection.
      await bank?.closeSession(connection.sessionId).catch((error: unknown) => {
        if (!(error instanceof BankError)) {
          throw error;
        }
      });
      await db.delete(connections).where(eq(connections.id, connection.id));
      return { available: bank !== null, connections: await readConnections(db, owner) };
    },
  };
};

export type MoneyService = ReturnType<typeof createMoneyService>;
