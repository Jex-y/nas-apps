import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { KINDS } from "../contract";

export const moneySchema = pgSchema("money");

export const kind = moneySchema.enum("kind", KINDS);

const localDate = (name: string) => date(name, { mode: "string" });
const instant = (name: string) => timestamp(name, { withTimezone: true });
/** Whole pence; far inside the range a JS number holds exactly. */
const pence = (name: string) => bigint(name, { mode: "number" });

/** Each tailnet login keeps its own accounts; nobody else sees them. */
export const accounts = moneySchema.table(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    kind: kind("kind").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index().on(table.owner)],
);

/** An account's balance at the end of a day. A day without a row carries the last one forward. */
export const balances = moneySchema.table(
  "balances",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: localDate("date").notNull(),
    amount: pence("amount").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.date] })],
);

/** A bank login waiting for the browser to come back from the bank with `state`. */
export const authorisations = moneySchema.table("authorisations", {
  state: uuid("state").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  institution: text("institution").notNull(),
  country: text("country").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

/** Consent a bank has given through Enable Banking, as one session. Renewing it replaces the session in place. */
export const connections = moneySchema.table(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    institution: text("institution").notNull(),
    country: text("country").notNull(),
    sessionId: text("session_id").notNull(),
    validUntil: instant("valid_until").notNull(),
    lastSyncedAt: instant("last_synced_at"),
    lastError: text("last_error"),
    /** Set once the owner has been told this consent is about to run out; cleared when it is renewed. */
    expiryWarnedAt: instant("expiry_warned_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.owner, table.institution, table.country)],
);

/** Marks an account as fed by a bank. Deleting the connection leaves the account and its history, now manual. */
export const bankLinks = moneySchema.table(
  "bank_links",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    /** Enable Banking's stable identity for the account, which survives renewing consent. */
    identificationHash: text("identification_hash").notNull(),
    /** The account's id within the current session only. */
    uid: text("uid").notNull(),
  },
  (table) => [unique().on(table.connectionId, table.identificationHash)],
);

/** Marks an account as fed by broker exports. */
export const portfolios = moneySchema.table("portfolios", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  cash: pence("cash").notNull(),
  importedOn: localDate("imported_on").notNull(),
});

/** A fund or share by its broker code, shared by everyone holding it. */
export const securities = moneySchema.table("securities", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** The FT Markets symbol it is repriced from; `null` leaves the price as last imported. */
  symbol: text("symbol"),
  /** Pence per unit. */
  price: doublePrecision("price").notNull(),
  pricedOn: localDate("priced_on").notNull(),
});

export const holdings = moneySchema.table(
  "holdings",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => portfolios.accountId, { onDelete: "cascade" }),
    code: text("code")
      .notNull()
      .references(() => securities.code),
    units: doublePrecision("units").notNull(),
    cost: pence("cost"),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.code] }), index().on(table.code)],
);

export const transactions = moneySchema.table(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The source's identity for the transaction, so importing it again changes nothing. */
    reference: text("reference").notNull(),
    bookedOn: localDate("booked_on").notNull(),
    amount: pence("amount").notNull(),
    description: text("description").notNull(),
    counterparty: text("counterparty"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.accountId, table.reference), index().on(table.accountId, table.bookedOn)],
);

/**
 * What a transaction was for. Every transaction has at least one, and they add up to its amount; the API keeps both
 * true, by writing the first with the transaction and only ever replacing the whole set.
 */
export const lineItems = moneySchema.table(
  "line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull().default(""),
    amount: pence("amount").notNull(),
  },
  (table) => [unique().on(table.transactionId, table.position)],
);

export const tags = moneySchema.table(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
  },
  (table) => [unique().on(table.owner, table.name)],
);

export const lineItemTags = moneySchema.table(
  "line_item_tags",
  {
    lineItemId: uuid("line_item_id")
      .notNull()
      .references(() => lineItems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.lineItemId, table.tagId] }), index().on(table.tagId)],
);
