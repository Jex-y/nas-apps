import { defineJob, defineSchedule, type JobQueue, type Notifier, type RegisteredJob, type Schedule } from "@apps/core";
import { and, eq, exists, isNotNull, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { type Bank, BankError, type BankTransaction, type Since } from "./bank";
import { addDays, londonDate } from "./calendar";
import type { MoneyDb } from "./db";
import { backfillBalances, fingerprint, holdersOf, recordTransactions, revaluePortfolios, setBalance } from "./ingest";
import type { PriceSource } from "./prices";
import { agrees, searchQueries, sterlingCandidates } from "./resolve";
import { bankLinks, connections, holdings, securities, transactions } from "./schema";

export type MoneyWorkDeps = {
  readonly db: MoneyDb;
  /** `null` when Enable Banking is not configured; nothing is then synced. */
  readonly bank: Bank | null;
  readonly prices: PriceSource;
  readonly queue: JobQueue;
  /** Reaches only the accounts' owner. */
  readonly notifier: (owner: string) => Notifier;
  readonly publicUrl: string;
  readonly now: () => Date;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Banks allow about four unattended reads a day, so three leaves one for a sync asked for by hand. */
const SYNC_EVERY_MS = 8 * HOUR;
/** How long before a consent lapses its owner is told to renew it. */
export const EXPIRY_WARNING_MS = 7 * DAY;
/** Re-read each sync, as a bank can book a transaction a few days into the past. */
const OVERLAP_DAYS = 10;
/** Quotes tried before a security is left for its owner to match by hand. */
const MAX_QUOTES = 12;

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });

const unreferenced = (entry: BankTransaction) => `${entry.bookedOn}|${entry.amount}|${entry.description}`;

export const createMoneyWork = ({ db, bank, prices, queue, notifier, publicUrl, now }: MoneyWorkDeps) => {
  const syncAccount = async (bank: Bank, link: typeof bankLinks.$inferSelect, signal: AbortSignal) => {
    const [latest] = await db
      .select({ bookedOn: max(transactions.bookedOn) })
      .from(transactions)
      .where(eq(transactions.accountId, link.accountId));
    const since: Since =
      latest?.bookedOn == null
        ? { kind: "everything" }
        : { kind: "from", date: addDays(latest.bookedOn, -OVERLAP_DAYS) };
    const entries = await bank.transactions(link.uid, since, signal);
    await recordTransactions(
      db,
      link.accountId,
      fingerprint(entries, unreferenced).map(({ row, fingerprint }) => ({
        ...row,
        reference: row.reference ?? fingerprint,
      })),
    );
    const balance = await bank.balance(link.uid, signal);
    if (balance !== null) {
      await backfillBalances(db, link.accountId, balance);
      await setBalance(db, link.accountId, londonDate(now()), balance);
    }
  };

  const syncConnection = defineJob({
    name: "money.sync-connection",
    payload: z.object({ connectionId: z.uuid() }),
    maxAttempts: 3,
    timeoutMs: 4 * MINUTE,
    handle: async ({ connectionId }, { signal }) => {
      const [connection] = await db.select().from(connections).where(eq(connections.id, connectionId));
      if (bank === null || connection === undefined || connection.validUntil <= now()) {
        return;
      }
      try {
        const links = await db.select().from(bankLinks).where(eq(bankLinks.connectionId, connectionId));
        for (const link of links) {
          await syncAccount(bank, link, signal);
        }
        await db
          .update(connections)
          .set({ lastSyncedAt: now(), lastError: null })
          .where(eq(connections.id, connectionId));
      } catch (error) {
        await db
          .update(connections)
          .set({ lastError: error instanceof Error ? error.message : String(error) })
          .where(eq(connections.id, connectionId));
        // The bank's own refusals (rate limits, a withdrawn consent) will not pass on a retry.
        if (!(error instanceof BankError)) {
          throw error;
        }
      }
    },
  });

  /** Tells the owner once that a consent is about to lapse; claimed and sent in one transaction, so never twice. */
  const warnOfExpiry = async (connection: typeof connections.$inferSelect) => {
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(connections)
        .set({ expiryWarnedAt: now() })
        .where(and(eq(connections.id, connection.id), isNull(connections.expiryWarnedAt)))
        .returning({ id: connections.id });
      if (claimed.length > 0) {
        await notifier(connection.owner).send({
          title: `Renew your ${connection.institution} link`,
          message: `Its consent runs out on ${dayMonth.format(connection.validUntil)}; after that nothing new is read.`,
          clickUrl: `${publicUrl}/money/accounts`,
          tag: connection.id,
        });
      }
    });
  };

  const syncBanks = defineJob({
    name: "money.sync-banks",
    payload: z.object({}),
    handle: async () => {
      const at = now();
      for (const connection of await db.select().from(connections)) {
        if (connection.validUntil.getTime() - at.getTime() < EXPIRY_WARNING_MS) {
          await warnOfExpiry(connection);
        }
        if (connection.validUntil > at) {
          await queue.enqueue(syncConnection, { connectionId: connection.id }, { dedupeKey: connection.id });
        }
      }
    },
  });

  const held = exists(db.select({ code: holdings.code }).from(holdings).where(eq(holdings.code, securities.code)));

  /** Fetches today's price for every held security that has a symbol, then values every portfolio at them. */
  const reprice = defineJob({
    name: "money.reprice",
    payload: z.object({}),
    timeoutMs: 4 * MINUTE,
    handle: async (_, { signal }) => {
      const today = londonDate(now());
      const tracked = await db
        .select({ code: securities.code, symbol: securities.symbol })
        .from(securities)
        .where(and(isNotNull(securities.symbol), held));
      for (const { code, symbol } of tracked) {
        const price = symbol === null ? null : await prices.quote(symbol, signal);
        if (price !== null) {
          await db.update(securities).set({ price, pricedOn: today }).where(eq(securities.code, code));
        }
      }
      await revaluePortfolios(db, today, null);
    },
  });

  /**
   * Finds the FT Markets symbol for a newly imported security: the first sterling search result whose price agrees
   * with the broker's, so a namesake or another share class is never taken for it.
   */
  const resolveSecurity = defineJob({
    name: "money.resolve-security",
    payload: z.object({ code: z.string().min(1) }),
    timeoutMs: 3 * MINUTE,
    handle: async ({ code }, { signal }) => {
      const [security] = await db.select().from(securities).where(eq(securities.code, code));
      if (security === undefined || security.symbol !== null) {
        return;
      }
      const tried = new Set<string>();
      for (const query of searchQueries(security.code, security.name)) {
        for (const { symbol } of sterlingCandidates(await prices.search(query, signal))) {
          if (tried.has(symbol)) {
            continue;
          }
          if (tried.size >= MAX_QUOTES) {
            return;
          }
          tried.add(symbol);
          const price = await prices.quote(symbol, signal);
          if (price !== null && agrees(price, security.price)) {
            const today = londonDate(now());
            await db.update(securities).set({ symbol, price, pricedOn: today }).where(eq(securities.code, code));
            await revaluePortfolios(db, today, await holdersOf(db, code));
            return;
          }
        }
      }
    },
  });

  const jobs: readonly RegisteredJob[] = [syncConnection, syncBanks, reprice, resolveSecurity];

  const schedules: readonly Schedule[] = [
    defineSchedule({
      name: "money.sync-banks",
      everyMs: SYNC_EVERY_MS,
      jitterMs: 30 * MINUTE,
      job: syncBanks,
      payload: {},
    }),
    defineSchedule({ name: "money.reprice", everyMs: DAY, jitterMs: HOUR, job: reprice, payload: {} }),
  ];

  return {
    jobs,
    schedules,
    definitions: { syncConnection, syncBanks, reprice, resolveSecurity },
    /** Reads a connection's accounts now; resolves `false` when a sync of it is already waiting. */
    syncSoon: (connectionId: string) => queue.enqueue(syncConnection, { connectionId }, { dedupeKey: connectionId }),
    /** Looks for the symbol of each security that has none. */
    resolveSoon: async (codes: readonly string[]) => {
      for (const code of codes) {
        await queue.enqueue(resolveSecurity, { code }, { dedupeKey: code });
      }
    },
  };
};

export type MoneyWork = ReturnType<typeof createMoneyWork>;
