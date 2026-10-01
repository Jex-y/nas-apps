import { sign } from "node:crypto";
import { z } from "zod";
import type { Institution } from "../contract";
import { penceOf } from "../pence";
import type { EnableBankingConfig } from "./config";

export type LinkedAccount = {
  /** The account's id within this session only. */
  readonly uid: string;
  /** Stable across sessions, so a renewed consent finds the same account. */
  readonly identificationHash: string;
  readonly name: string | null;
  readonly currency: string;
};

export type BankSession = {
  readonly sessionId: string;
  readonly validUntil: Date;
  readonly accounts: readonly LinkedAccount[];
};

export type BankTransaction = {
  /** The bank's own id for the entry; `null` from banks that give none. */
  readonly reference: string | null;
  readonly bookedOn: string;
  readonly amount: number;
  readonly description: string;
  readonly counterparty: string | null;
};

export type Authorise = {
  readonly institution: Institution;
  /** Echoed back on the redirect, to tie it to whoever started this. */
  readonly state: string;
  readonly redirectUrl: string;
};

/** How far back to read: everything the bank will give, or only from a day on. */
export type Since = { readonly kind: "everything" } | { readonly kind: "from"; readonly date: string };

/** Read-only access to bank accounts their owner has consented to share. */
export type Bank = {
  readonly institutions: (country: string) => Promise<readonly Institution[]>;
  /** The bank's login page to send the browser to. */
  readonly authorise: (request: Authorise) => Promise<string>;
  /** Trades the `code` the bank redirected back with for a session. */
  readonly openSession: (code: string) => Promise<BankSession>;
  readonly closeSession: (sessionId: string) => Promise<void>;
  /** The booked sterling balance; `null` when the bank reports none. */
  readonly balance: (uid: string, signal: AbortSignal) => Promise<number | null>;
  /** Booked transactions only: a pending one has no stable identity and may still change or vanish. */
  readonly transactions: (uid: string, since: Since, signal: AbortSignal) => Promise<readonly BankTransaction[]>;
};

/** Enable Banking refused a request; `message` is its own explanation. */
export class BankError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const API = "https://api.enablebanking.com";
const TOKEN_TTL_SECONDS = 3600;
const DAY_SECONDS = 86_400;
/** Asked for when a bank does not say how long its consent may last. */
const DEFAULT_CONSENT_SECONDS = 90 * DAY_SECONDS;

/** Booked balances first, then what is available, which can include an overdraft limit. */
const BALANCE_TYPES = ["CLBD", "ITBD", "XPCD", "OPBD", "CLAV", "ITAV"];

const Aspsp = z.object({
  name: z.string(),
  country: z.string(),
  maximum_consent_validity: z.number().nullish(),
});

const AccountResource = z.object({
  uid: z.string(),
  identification_hash: z.string(),
  name: z.string().nullish(),
  product: z.string().nullish(),
  currency: z.string(),
});

const Session = z.object({
  session_id: z.string(),
  accounts: z.array(AccountResource),
  access: z.object({ valid_until: z.iso.datetime({ offset: true }) }),
});

const Amount = z.object({ currency: z.string(), amount: z.string() });

const Balances = z.object({ balances: z.array(z.object({ balance_amount: Amount, balance_type: z.string() })) });

const Party = z.object({ name: z.string().nullish() }).nullish();

const Entry = z.object({
  entry_reference: z.string().nullish(),
  transaction_amount: Amount,
  credit_debit_indicator: z.string(),
  status: z.string(),
  booking_date: z.string().nullish(),
  value_date: z.string().nullish(),
  transaction_date: z.string().nullish(),
  creditor: Party,
  debtor: Party,
  remittance_information: z.array(z.string()).nullish(),
  bank_transaction_code: z.object({ description: z.string().nullish() }).nullish(),
});
type Entry = z.infer<typeof Entry>;

const Transactions = z.object({ transactions: z.array(Entry), continuation_key: z.string().nullish() });

const base64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

const transactionOf = (entry: Entry): BankTransaction | null => {
  const credit = entry.credit_debit_indicator === "CRDT";
  const magnitude = penceOf(entry.transaction_amount.amount);
  const bookedOn = entry.booking_date ?? entry.value_date ?? entry.transaction_date;
  if (entry.status !== "BOOK" || magnitude === null || bookedOn == null) {
    return null;
  }
  const counterparty = (credit ? entry.debtor?.name : entry.creditor?.name) ?? null;
  return {
    reference: entry.entry_reference ?? null,
    bookedOn: bookedOn.slice(0, 10),
    amount: credit ? magnitude : -magnitude,
    description:
      entry.remittance_information?.join(" ").trim() || entry.bank_transaction_code?.description || counterparty || "",
    counterparty,
  };
};

export type EnableBankingOptions = {
  readonly config: EnableBankingConfig;
  readonly now: () => Date;
  readonly fetch?: typeof fetch;
};

export const createEnableBanking = ({ config, now, fetch: send = fetch }: EnableBankingOptions): Bank => {
  let token: { readonly value: string; readonly expires: number } | null = null;

  /** Signed with the application's key; reused until a minute before it lapses. */
  const bearer = (): string => {
    const issued = Math.floor(now().getTime() / 1000);
    if (token === null || token.expires - 60 <= issued) {
      const header = base64Url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: config.appId }));
      const claims = base64Url(
        JSON.stringify({
          iss: "enablebanking.com",
          aud: "api.enablebanking.com",
          iat: issued,
          exp: issued + TOKEN_TTL_SECONDS,
        }),
      );
      const signature = base64Url(sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), config.privateKey));
      token = { value: `${header}.${claims}.${signature}`, expires: issued + TOKEN_TTL_SECONDS };
    }
    return token.value;
  };

  const call = async <S extends z.ZodType>(
    schema: S,
    path: string,
    init: { readonly method?: string; readonly body?: unknown; readonly signal?: AbortSignal } = {},
  ): Promise<z.infer<S>> => {
    const response = await send(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${bearer()}`, "Content-Type": "application/json" },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      ...(init.signal !== undefined && { signal: init.signal }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const said = z.object({ message: z.string() }).safeParse(body);
      throw new BankError(
        response.status,
        said.success ? said.data.message : `Enable Banking answered ${response.status}`,
      );
    }
    return schema.parse(body);
  };

  const aspsps = async (country: string) =>
    (
      await call(
        z.object({ aspsps: z.array(Aspsp) }),
        `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`,
      )
    ).aspsps;

  return {
    institutions: async (country) => (await aspsps(country)).map(({ name, country }) => ({ name, country })),

    authorise: async ({ institution, state, redirectUrl }) => {
      const aspsp = (await aspsps(institution.country)).find((other) => other.name === institution.name);
      const consentSeconds = aspsp?.maximum_consent_validity ?? DEFAULT_CONSENT_SECONDS;
      const { url } = await call(z.object({ url: z.url() }), "/auth", {
        method: "POST",
        body: {
          access: { valid_until: new Date(now().getTime() + consentSeconds * 1000).toISOString() },
          aspsp: institution,
          state,
          redirect_url: redirectUrl,
          psu_type: "personal",
        },
      });
      return url;
    },

    openSession: async (code) => {
      const session = await call(Session, "/sessions", { method: "POST", body: { code } });
      return {
        sessionId: session.session_id,
        validUntil: new Date(session.access.valid_until),
        accounts: session.accounts.map((account) => ({
          uid: account.uid,
          identificationHash: account.identification_hash,
          name: account.name ?? account.product ?? null,
          currency: account.currency,
        })),
      };
    },

    closeSession: async (sessionId) => {
      await call(z.unknown(), `/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    },

    balance: async (uid, signal) => {
      const { balances } = await call(Balances, `/accounts/${encodeURIComponent(uid)}/balances`, { signal });
      const sterling = balances.filter((balance) => balance.balance_amount.currency === "GBP");
      const rank = (type: string) =>
        BALANCE_TYPES.includes(type) ? BALANCE_TYPES.indexOf(type) : BALANCE_TYPES.length;
      const [best] = sterling.toSorted((a, b) => rank(a.balance_type) - rank(b.balance_type));
      return best === undefined ? null : penceOf(best.balance_amount.amount);
    },

    transactions: async (uid, since, signal) => {
      const query = new URLSearchParams({ transaction_status: "BOOK" });
      if (since.kind === "from") {
        query.set("date_from", since.date);
      } else {
        query.set("strategy", "longest");
      }
      const entries: Entry[] = [];
      for (let key: string | null = null; ; ) {
        if (key !== null) {
          query.set("continuation_key", key);
        }
        const page = await call(Transactions, `/accounts/${encodeURIComponent(uid)}/transactions?${query}`, { signal });
        entries.push(...page.transactions);
        key = page.continuation_key ?? null;
        if (key === null) {
          break;
        }
      }
      return entries.flatMap((entry) => transactionOf(entry) ?? []);
    },
  };
};
