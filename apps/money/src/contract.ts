import { z } from "zod";

export const MONEY_API = "/money/api";

/** Where a bank sends the browser back to after consent; it must be registered with Enable Banking. */
export const BANK_CALLBACK_PATH = `${MONEY_API}/bank/callback`;

/** What an account holds, which is how net worth is broken down. */
export const KINDS = ["cash", "investment", "property", "pension", "debt", "other"] as const;
export type Kind = (typeof KINDS)[number];

/** Whole pence. Money leaving an account, and anything owed, is negative. */
export const Pence = z.number().int().min(-1e13).max(1e13);
export type Pence = z.infer<typeof Pence>;

const LocalDate = z.iso.date();
const Instant = z.iso.datetime();
const count = z.number().int().nonnegative();
const Name = z.string().trim().min(1).max(100);

/** What keeps an account's balance up to date. Only a manual account's balance can be set by hand. */
export const Feed = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bank"), connectionId: z.uuid(), institution: z.string() }),
  /** Holdings from a broker export, revalued daily; `cash` is what the export said was uninvested. */
  z.object({ kind: z.literal("portfolio"), cash: Pence, importedOn: LocalDate }),
  z.object({ kind: z.literal("manual") }),
]);
export type Feed = z.infer<typeof Feed>;

export const Balance = z.object({ on: LocalDate, amount: Pence });
export type Balance = z.infer<typeof Balance>;

export const Account = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(KINDS),
  feed: Feed,
  /** The latest balance known; `null` until the account has one. */
  balance: Balance.nullable(),
});
export type Account = z.infer<typeof Account>;

export const AccountList = z.array(Account);
export type AccountList = z.infer<typeof AccountList>;

export const BalanceList = z.array(Balance);
export type BalanceList = z.infer<typeof BalanceList>;

export const CreateAccount = z.object({ name: Name, kind: z.enum(KINDS) });
export type CreateAccount = z.infer<typeof CreateAccount>;

export const UpdateAccount = z
  .object({ name: Name.optional(), kind: z.enum(KINDS).optional() })
  .refine((update) => Object.keys(update).length > 0, { message: "Nothing to update" });
export type UpdateAccount = z.infer<typeof UpdateAccount>;

export const SetBalance = z.object({ amount: Pence });
export type SetBalance = z.infer<typeof SetBalance>;

/** Every account's balance on a day, summed by kind; an account counts from its first known balance. */
export const NetWorthPoint = z.object({ date: LocalDate, byKind: z.record(z.enum(KINDS), Pence) });
export type NetWorthPoint = z.infer<typeof NetWorthPoint>;

/** Oldest first, ending today. */
export const NetWorthSeries = z.array(NetWorthPoint);
export type NetWorthSeries = z.infer<typeof NetWorthSeries>;

export const NetWorthQuery = z.object({ months: z.coerce.number().int().min(1).max(240).default(12) });

export const TagName = z.string().trim().toLowerCase().min(1).max(40);

export const LineItem = z.object({
  id: z.uuid(),
  /** Empty on the single item of a transaction that has not been broken down. */
  description: z.string(),
  amount: Pence,
  tags: z.array(z.string()),
});
export type LineItem = z.infer<typeof LineItem>;

export const Transaction = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  bookedOn: LocalDate,
  amount: Pence,
  description: z.string(),
  counterparty: z.string().nullable(),
  /** At least one, always adding up to `amount`. */
  items: z.array(LineItem),
});
export type Transaction = z.infer<typeof Transaction>;

export const TransactionPage = z.object({
  /** Newest first. */
  transactions: z.array(Transaction),
  /** Pass as `before` for the next page; `null` on the last. */
  next: z.string().nullable(),
});
export type TransactionPage = z.infer<typeof TransactionPage>;

/** Which transactions to list by their tags: all of them, those with an untagged item, or those with an item tagged so. */
export type TagFilter =
  | { readonly kind: "any" }
  | { readonly kind: "untagged" }
  | { readonly kind: "tagged"; readonly name: string };

export type TransactionFilter = {
  readonly accountId: string | null;
  readonly tags: TagFilter;
  /** Matched against the description, the counterparty and line item descriptions. */
  readonly search: string | null;
};

export const NewLineItem = z.object({
  description: z.string().trim().max(200),
  amount: Pence,
  tags: z.array(TagName).max(10),
});
export type NewLineItem = z.infer<typeof NewLineItem>;

/** Replaces a transaction's line items; they must add up to its amount. One item puts it back together. */
export const SplitTransaction = z.object({ items: z.array(NewLineItem).min(1).max(50) });
export type SplitTransaction = z.infer<typeof SplitTransaction>;

export const Tag = z.object({ name: z.string(), items: count });
export type Tag = z.infer<typeof Tag>;

export const TagList = z.array(Tag);
export type TagList = z.infer<typeof TagList>;

export const RenameTag = z.object({ name: TagName });
export type RenameTag = z.infer<typeof RenameTag>;

/** A calendar month of line items in cash accounts. An item with several tags counts under each of them. */
export const MonthSpending = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  income: Pence,
  /** Zero or negative. */
  outgoings: Pence,
  /** Net per tag, biggest outgoing first; `null` gathers the untagged items. */
  byTag: z.array(z.object({ tag: z.string().nullable(), amount: Pence })),
});
export type MonthSpending = z.infer<typeof MonthSpending>;

/** Newest month first. */
export const Spending = z.array(MonthSpending);
export type Spending = z.infer<typeof Spending>;

export const SpendingQuery = z.object({ months: z.coerce.number().int().min(1).max(60).default(6) });

export const Holding = z.object({
  accountId: z.uuid(),
  /** The broker's code for the security: a SEDOL for a fund, a ticker for a share. */
  code: z.string(),
  name: z.string(),
  units: z.number(),
  /** Pence per unit, which funds quote to fractions of a penny. */
  price: z.number(),
  pricedOn: LocalDate,
  value: Pence,
  cost: Pence.nullable(),
  /** The FT Markets symbol it is repriced from each day; `null` leaves it at the last imported price. */
  symbol: z.string().nullable(),
});
export type Holding = z.infer<typeof Holding>;

export const HoldingList = z.array(Holding);
export type HoldingList = z.infer<typeof HoldingList>;

export const SetSymbol = z.object({ symbol: z.string().trim().min(1).max(40).nullable() });
export type SetSymbol = z.infer<typeof SetSymbol>;

/** A Hargreaves Lansdown CSV export: an account's holdings or its transaction history. */
export const ImportHl = z.object({
  csv: z.string().min(1).max(2_000_000),
  /** The account it belongs to. A holdings export may leave it `null` to go by the account named in the file. */
  accountId: z.uuid().nullable().default(null),
});
export type ImportHl = z.input<typeof ImportHl>;

export const ImportResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("holdings"), accountId: z.uuid(), holdings: count }),
  z.object({ kind: z.literal("transactions"), accountId: z.uuid(), added: count }),
]);
export type ImportResult = z.infer<typeof ImportResult>;

export const Institution = z.object({ name: z.string().min(1).max(200), country: z.string().length(2) });
export type Institution = z.infer<typeof Institution>;

export const InstitutionList = z.array(Institution);

export const Connection = z.object({
  id: z.uuid(),
  institution: z.string(),
  country: z.string(),
  /** When the bank's consent runs out and the link must be renewed. */
  validUntil: Instant,
  lastSyncedAt: Instant.nullable(),
  /** Why the last sync failed; `null` once one succeeds. */
  lastError: z.string().nullable(),
});
export type Connection = z.infer<typeof Connection>;

export const Banking = z.object({
  /** `false` when Enable Banking is not configured, so nothing can be linked. */
  available: z.boolean(),
  connections: z.array(Connection),
});
export type Banking = z.infer<typeof Banking>;

export const StartAuthorisation = z.object({ institution: Institution });
export type StartAuthorisation = z.infer<typeof StartAuthorisation>;

/** Where to send the browser for the bank's own login. */
export const Authorisation = z.object({ url: z.url() });
export type Authorisation = z.infer<typeof Authorisation>;
