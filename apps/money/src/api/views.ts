import { and, asc, count, desc, eq, exists, gte, ilike, inArray, notExists, or, type SQL, sql } from "drizzle-orm";
import type {
  AccountList,
  BalanceList,
  Connection,
  Feed,
  HoldingList,
  Spending,
  TagFilter,
  TagList,
  Transaction,
  TransactionFilter,
  TransactionPage,
} from "../contract";
import type { MoneyDb } from "./db";
import type { BalancePoint } from "./net-worth";
import {
  accounts,
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

export type MoneyReader = Pick<MoneyDb, "select" | "selectDistinctOn">;

export const readAccounts = async (db: MoneyReader, owner: string): Promise<AccountList> => {
  const rows = await db
    .select({ account: accounts, connection: connections, portfolio: portfolios })
    .from(accounts)
    .leftJoin(bankLinks, eq(bankLinks.accountId, accounts.id))
    .leftJoin(connections, eq(connections.id, bankLinks.connectionId))
    .leftJoin(portfolios, eq(portfolios.accountId, accounts.id))
    .where(eq(accounts.owner, owner))
    .orderBy(asc(accounts.kind), asc(accounts.name), asc(accounts.id));
  const latest = await db
    .selectDistinctOn([balances.accountId], {
      accountId: balances.accountId,
      on: balances.date,
      amount: balances.amount,
    })
    .from(balances)
    .innerJoin(accounts, eq(accounts.id, balances.accountId))
    .where(eq(accounts.owner, owner))
    .orderBy(balances.accountId, desc(balances.date));
  const balanceOf = new Map(latest.map(({ accountId, ...balance }) => [accountId, balance]));

  return rows.map(({ account, connection, portfolio }) => {
    const feed: Feed =
      connection !== null
        ? { kind: "bank", connectionId: connection.id, institution: connection.institution }
        : portfolio !== null
          ? { kind: "portfolio", cash: portfolio.cash, importedOn: portfolio.importedOn }
          : { kind: "manual" };
    return { id: account.id, name: account.name, kind: account.kind, feed, balance: balanceOf.get(account.id) ?? null };
  });
};

/** Newest first. */
export const readBalances = async (db: MoneyReader, accountId: string): Promise<BalanceList> =>
  db
    .select({ on: balances.date, amount: balances.amount })
    .from(balances)
    .where(eq(balances.accountId, accountId))
    .orderBy(desc(balances.date));

export const readBalancePoints = async (db: MoneyReader, owner: string): Promise<BalancePoint[]> =>
  db
    .select({ accountId: balances.accountId, kind: accounts.kind, date: balances.date, amount: balances.amount })
    .from(balances)
    .innerJoin(accounts, eq(accounts.id, balances.accountId))
    .where(eq(accounts.owner, owner));

export const readConnections = async (db: MoneyReader, owner: string): Promise<Connection[]> => {
  const rows = await db
    .select()
    .from(connections)
    .where(eq(connections.owner, owner))
    .orderBy(asc(connections.institution));
  return rows.map((row) => ({
    id: row.id,
    institution: row.institution,
    country: row.country,
    validUntil: row.validUntil.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
  }));
};

const transactionsByIds = async (db: MoneyReader, ids: readonly string[]): Promise<Map<string, Transaction>> => {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.id, [...ids]));
  const items = await db
    .select()
    .from(lineItems)
    .where(inArray(lineItems.transactionId, [...ids]))
    .orderBy(asc(lineItems.position));
  const tagged = await db
    .select({ lineItemId: lineItemTags.lineItemId, name: tags.name })
    .from(lineItemTags)
    .innerJoin(tags, eq(tags.id, lineItemTags.tagId))
    .innerJoin(lineItems, eq(lineItems.id, lineItemTags.lineItemId))
    .where(inArray(lineItems.transactionId, [...ids]))
    .orderBy(asc(tags.name));
  const tagsOf = Map.groupBy(tagged, (row) => row.lineItemId);
  const itemsOf = Map.groupBy(items, (item) => item.transactionId);

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        accountId: row.accountId,
        bookedOn: row.bookedOn,
        amount: row.amount,
        description: row.description,
        counterparty: row.counterparty,
        items: (itemsOf.get(row.id) ?? []).map((item) => ({
          id: item.id,
          description: item.description,
          amount: item.amount,
          tags: (tagsOf.get(item.id) ?? []).map((tag) => tag.name),
        })),
      },
    ]),
  );
};

export const readTransaction = async (db: MoneyReader, transactionId: string): Promise<Transaction | undefined> =>
  (await transactionsByIds(db, [transactionId])).get(transactionId);

const ownItems = eq(lineItems.transactionId, transactions.id);

const tagCondition = (db: MoneyReader, filter: TagFilter): SQL | undefined => {
  switch (filter.kind) {
    case "any":
      return undefined;
    case "untagged":
      return exists(
        db
          .select({ one: sql`1` })
          .from(lineItems)
          .where(
            and(
              ownItems,
              notExists(db.select({ one: sql`1` }).from(lineItemTags).where(eq(lineItemTags.lineItemId, lineItems.id))),
            ),
          ),
      );
    case "tagged":
      return exists(
        db
          .select({ one: sql`1` })
          .from(lineItems)
          .innerJoin(lineItemTags, eq(lineItemTags.lineItemId, lineItems.id))
          .innerJoin(tags, eq(tags.id, lineItemTags.tagId))
          .where(and(ownItems, eq(tags.name, filter.name))),
      );
  }
};

const searchCondition = (db: MoneyReader, search: string | null): SQL | undefined => {
  if (search === null) {
    return undefined;
  }
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  return or(
    ilike(transactions.description, pattern),
    ilike(transactions.counterparty, pattern),
    exists(
      db
        .select({ one: sql`1` })
        .from(lineItems)
        .where(and(ownItems, ilike(lineItems.description, pattern))),
    ),
  );
};

/** A page's last transaction, as the `before` that fetches the page after it. */
export type Cursor = { readonly bookedOn: string; readonly id: string };

export const readTransactions = async (
  db: MoneyReader,
  owner: string,
  filter: TransactionFilter,
  before: Cursor | null,
  limit: number,
): Promise<TransactionPage> => {
  const page = await db
    .select({ id: transactions.id, bookedOn: transactions.bookedOn })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(accounts.owner, owner),
        filter.accountId === null ? undefined : eq(transactions.accountId, filter.accountId),
        tagCondition(db, filter.tags),
        searchCondition(db, filter.search),
        before === null
          ? undefined
          : sql`(${transactions.bookedOn}, ${transactions.id}) < (${before.bookedOn}::date, ${before.id}::uuid)`,
      ),
    )
    .orderBy(desc(transactions.bookedOn), desc(transactions.id))
    .limit(limit + 1);
  const shown = page.slice(0, limit);
  const byId = await transactionsByIds(
    db,
    shown.map((row) => row.id),
  );
  const last = shown.at(-1);
  return {
    transactions: shown.flatMap((row) => byId.get(row.id) ?? []),
    next: page.length > limit && last !== undefined ? `${last.bookedOn}_${last.id}` : null,
  };
};

export const readTags = async (db: MoneyReader, owner: string): Promise<TagList> =>
  db
    .select({ name: tags.name, items: count(lineItemTags.lineItemId) })
    .from(tags)
    .leftJoin(lineItemTags, eq(lineItemTags.tagId, tags.id))
    .where(eq(tags.owner, owner))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));

/** From the month containing `from` to now, counting only cash accounts so buying investments is not spending. */
export const readSpending = async (db: MoneyReader, owner: string, from: string): Promise<Spending> => {
  const month = sql<string>`to_char(${transactions.bookedOn}, 'YYYY-MM')`;
  const inScope = and(eq(accounts.owner, owner), eq(accounts.kind, "cash"), gte(transactions.bookedOn, from));
  const totals = await db
    .select({
      month,
      income: sql<number>`coalesce(sum(${lineItems.amount}) filter (where ${lineItems.amount} > 0), 0)`.mapWith(Number),
      outgoings: sql<number>`coalesce(sum(${lineItems.amount}) filter (where ${lineItems.amount} < 0), 0)`.mapWith(
        Number,
      ),
    })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(inScope)
    .groupBy(month)
    .orderBy(desc(month));
  const tagged = await db
    .select({ month, tag: tags.name, amount: sql<number>`sum(${lineItems.amount})`.mapWith(Number) })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(lineItemTags, eq(lineItemTags.lineItemId, lineItems.id))
    .leftJoin(tags, eq(tags.id, lineItemTags.tagId))
    .where(inScope)
    .groupBy(month, tags.name);
  const byMonth = Map.groupBy(tagged, (row) => row.month);

  return totals.map((total) => ({
    ...total,
    byTag: (byMonth.get(total.month) ?? [])
      .map(({ tag, amount }) => ({ tag, amount }))
      .toSorted((a, b) => a.amount - b.amount),
  }));
};

export const readHoldings = async (db: MoneyReader, owner: string): Promise<HoldingList> => {
  const rows = await db
    .select({ holding: holdings, security: securities })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .innerJoin(securities, eq(securities.code, holdings.code))
    .where(eq(accounts.owner, owner))
    .orderBy(asc(accounts.name), asc(securities.name));
  return rows.map(({ holding, security }) => ({
    accountId: holding.accountId,
    code: security.code,
    name: security.name,
    units: holding.units,
    price: security.price,
    pricedOn: security.pricedOn,
    value: Math.round(holding.units * security.price),
    cost: holding.cost,
    symbol: security.symbol,
  }));
};
