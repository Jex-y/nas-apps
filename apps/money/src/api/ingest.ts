import { eq, inArray, sql } from "drizzle-orm";
import type { MoneyDb } from "./db";
import { balances, holdings, lineItems, portfolios, securities, transactions } from "./schema";

export type NewTransaction = {
  readonly reference: string;
  readonly bookedOn: string;
  readonly amount: number;
  readonly description: string;
  readonly counterparty: string | null;
};

export type Fingerprinted<T> = { readonly row: T; readonly fingerprint: string };

/**
 * An identity for rows whose source gives none: `key` plus how many identical rows came before, so the same rows
 * read again get the same fingerprints. Only stable when `rows` holds whole days in a consistent order.
 */
export const fingerprint = <T>(rows: readonly T[], key: (row: T) => string): Fingerprinted<T>[] => {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const identity = key(row);
    const earlier = seen.get(identity) ?? 0;
    seen.set(identity, earlier + 1);
    return { row, fingerprint: `~${identity}|${earlier}` };
  });
};

const CHUNK = 1000;

/** Adds the transactions not already recorded, each with one line item for its whole amount; returns how many. */
export const recordTransactions = async (
  db: MoneyDb,
  accountId: string,
  rows: readonly NewTransaction[],
): Promise<number> =>
  db.transaction(async (tx) => {
    let added = 0;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const inserted = await tx
        .insert(transactions)
        .values(rows.slice(start, start + CHUNK).map((row) => ({ ...row, accountId })))
        .onConflictDoNothing({ target: [transactions.accountId, transactions.reference] })
        .returning({ id: transactions.id, amount: transactions.amount });
      if (inserted.length > 0) {
        await tx
          .insert(lineItems)
          .values(inserted.map(({ id, amount }) => ({ transactionId: id, position: 0, amount })));
      }
      added += inserted.length;
    }
    return added;
  });

export const setBalance = async (
  db: Pick<MoneyDb, "insert">,
  accountId: string,
  date: string,
  amount: number,
): Promise<void> => {
  await db
    .insert(balances)
    .values({ accountId, date, amount })
    .onConflictDoUpdate({ target: [balances.accountId, balances.date], set: { amount } });
};

/**
 * Works a bank account's past balances back from `balance` now: at the end of each day with transactions it held
 * `balance` less everything booked since.
 */
export const backfillBalances = async (db: MoneyDb, accountId: string, balance: number): Promise<void> => {
  await db.execute(sql`
    insert into ${balances} (account_id, date, amount)
    select ${accountId}::uuid, daily.booked_on, (${balance}::bigint - coalesce(sum(daily.amount) over later, 0))::bigint
    from (
      select booked_on, sum(amount) as amount from ${transactions} where account_id = ${accountId}::uuid group by booked_on
    ) daily
    window later as (order by daily.booked_on desc rows between unbounded preceding and 1 preceding)
    on conflict (account_id, date) do update set amount = excluded.amount
  `);
};

/**
 * Records each portfolio's worth on `date` at current prices: its holdings plus its cash. All of them when `null`.
 * Each holding is rounded as `numeric`, half up like `Math.round`, so the total matches the values shown beside it.
 */
export const revaluePortfolios = async (
  db: Pick<MoneyDb, "execute">,
  date: string,
  accountIds: readonly string[] | null,
): Promise<void> => {
  if (accountIds !== null && accountIds.length === 0) {
    return;
  }
  await db.execute(sql`
    insert into ${balances} (account_id, date, amount)
    select ${portfolios.accountId}, ${date}::date,
      ${portfolios.cash} + coalesce(sum(round((${holdings.units} * ${securities.price})::numeric)), 0)::bigint
    from ${portfolios}
    left join ${holdings} on ${holdings.accountId} = ${portfolios.accountId}
    left join ${securities} on ${securities.code} = ${holdings.code}
    where ${accountIds === null ? sql`true` : inArray(portfolios.accountId, [...accountIds])}
    group by ${portfolios.accountId}, ${portfolios.cash}
    on conflict (account_id, date) do update set amount = excluded.amount
  `);
};

/** The portfolios holding a security, to revalue once its price changes. */
export const holdersOf = async (db: Pick<MoneyDb, "select">, code: string): Promise<readonly string[]> =>
  (await db.select({ accountId: holdings.accountId }).from(holdings).where(eq(holdings.code, code))).map(
    (row) => row.accountId,
  );
