import { describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { BankError, createEnableBanking } from "./bank";
import { parseMoneyConfig } from "./config";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const NOW = new Date("2026-09-21T11:00:00Z");

type Call = { readonly method: string; readonly path: string; readonly body: unknown; readonly token: string };

/** Enable Banking answering each `METHOD /path` (query included) with the JSON given, recording what it was sent. */
const fakeApi = (answers: Readonly<Record<string, unknown>>, status = 200) => {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    calls.push({
      method,
      path,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      token: new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "",
    });
    return Response.json(answers[`${method} ${path}`] ?? { message: "Not found" }, {
      status: `${method} ${path}` in answers ? status : 404,
    });
  }) as typeof globalThis.fetch;
  const bank = createEnableBanking({ config: { appId: "app-id", privateKey }, now: () => NOW, fetch });
  return { bank, calls };
};

const signal = AbortSignal.timeout(5_000);

describe("Enable Banking", () => {
  test("signs each request as the application", async () => {
    const { bank, calls } = fakeApi({ "GET /aspsps?country=GB&psu_type=personal": { aspsps: [] } });

    await bank.institutions("GB");

    const [header = "", claims = "", signature = ""] = calls[0]?.token.split(".") ?? [];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "RS256",
      kid: "app-id",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 3600,
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        createPublicKey(privateKey),
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  test("asks for as long a consent as the bank allows, and opens the session the login leads to", async () => {
    const { bank, calls } = fakeApi({
      "GET /aspsps?country=GB&psu_type=personal": {
        aspsps: [
          { name: "Barclays", country: "GB" },
          { name: "HSBC", country: "GB", maximum_consent_validity: 7_776_000 },
        ],
      },
      "POST /auth": { url: "https://tilisy.enablebanking.com/welcome?sessionid=1", authorization_id: "a" },
      "POST /sessions": {
        session_id: "session-1",
        access: { valid_until: "2026-12-20T11:00:00.000000+00:00" },
        accounts: [
          { uid: "uid-1", identification_hash: "hash-1", name: null, product: "Bank Account", currency: "GBP" },
          { uid: "uid-2", identification_hash: "hash-2", currency: "EUR" },
        ],
      },
    });

    expect(await bank.institutions("GB")).toEqual([
      { name: "Barclays", country: "GB" },
      { name: "HSBC", country: "GB" },
    ]);
    const url = await bank.authorise({
      institution: { name: "HSBC", country: "GB" },
      state: "state-1",
      redirectUrl: "https://apps.example/money/api/bank/callback",
    });

    expect(url).toBe("https://tilisy.enablebanking.com/welcome?sessionid=1");
    expect(calls.at(-1)?.body).toEqual({
      access: { valid_until: "2026-12-20T11:00:00.000Z" },
      aspsp: { name: "HSBC", country: "GB" },
      state: "state-1",
      redirect_url: "https://apps.example/money/api/bank/callback",
      psu_type: "personal",
    });
    expect(await bank.openSession("code-1")).toEqual({
      sessionId: "session-1",
      validUntil: new Date("2026-12-20T11:00:00Z"),
      accounts: [
        { uid: "uid-1", identificationHash: "hash-1", name: "Bank Account", currency: "GBP" },
        { uid: "uid-2", identificationHash: "hash-2", name: null, currency: "EUR" },
      ],
    });
    expect(calls.at(-1)?.body).toEqual({ code: "code-1" });
  });

  test("reads every page of booked transactions, signed by direction", async () => {
    const booked = { status: "BOOK", transaction_amount: { currency: "GBP", amount: "25.00" } };
    const { bank, calls } = fakeApi({
      "GET /accounts/uid-1/transactions?transaction_status=BOOK&date_from=2026-09-10": {
        transactions: [
          {
            ...booked,
            entry_reference: "e1",
            credit_debit_indicator: "DBIT",
            booking_date: "2026-09-18",
            creditor: { name: "Tesco" },
            remittance_information: ["TESCO STORES", "6435"],
          },
          { ...booked, status: "PDNG", credit_debit_indicator: "DBIT", booking_date: "2026-09-21" },
        ],
        continuation_key: "page-2",
      },
      "GET /accounts/uid-1/transactions?transaction_status=BOOK&date_from=2026-09-10&continuation_key=page-2": {
        transactions: [
          {
            ...booked,
            transaction_amount: { currency: "GBP", amount: "2000.5" },
            credit_debit_indicator: "CRDT",
            value_date: "2026-09-20",
            debtor: { name: "Employer Ltd" },
            creditor: { name: "Me" },
            remittance_information: [],
            bank_transaction_code: { description: "Salary" },
          },
          { ...booked, credit_debit_indicator: "DBIT" },
        ],
        continuation_key: null,
      },
    });

    expect(await bank.transactions("uid-1", { kind: "from", date: "2026-09-10" }, signal)).toEqual([
      {
        reference: "e1",
        bookedOn: "2026-09-18",
        amount: -2500,
        description: "TESCO STORES 6435",
        counterparty: "Tesco",
      },
      { reference: null, bookedOn: "2026-09-20", amount: 200050, description: "Salary", counterparty: "Employer Ltd" },
    ]);
    expect(calls).toHaveLength(2);
  });

  test("asks for the longest history a bank will give when there is none yet", async () => {
    const { bank } = fakeApi({
      "GET /accounts/uid-1/transactions?transaction_status=BOOK&strategy=longest": { transactions: [] },
    });

    expect(await bank.transactions("uid-1", { kind: "everything" }, signal)).toEqual([]);
  });

  test("prefers the booked sterling balance to what is available", async () => {
    const balance = (balance_type: string, amount: string, currency = "GBP") => ({
      balance_type,
      balance_amount: { currency, amount },
    });
    const { bank } = fakeApi({
      "GET /accounts/uid-1/balances": {
        balances: [balance("ITAV", "1750.00"), balance("ITBD", "-250.10"), balance("CLBD", "9.99", "EUR")],
      },
      "GET /accounts/uid-2/balances": { balances: [balance("CLBD", "9.99", "EUR")] },
    });

    expect(await bank.balance("uid-1", signal)).toBe(-25010);
    expect(await bank.balance("uid-2", signal)).toBeNull();
  });

  test("passes on why a request was refused", async () => {
    const { bank } = fakeApi(
      { "GET /accounts/uid-1/balances": { code: 429, message: "ASPSP_RATE_LIMIT_EXCEEDED" } },
      429,
    );

    const refusal = await bank.balance("uid-1", signal).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(BankError);
    expect(refusal).toMatchObject({ status: 429, message: "ASPSP_RATE_LIMIT_EXCEEDED" });
  });
});

describe("parseMoneyConfig", () => {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  test("leaves bank linking off when nothing is set", () => {
    expect(parseMoneyConfig({})).toEqual({ enableBanking: null });
    expect(parseMoneyConfig({ ENABLE_BANKING_APP_ID: "", ENABLE_BANKING_PRIVATE_KEY: " " })).toEqual({
      enableBanking: null,
    });
  });

  test("reads the key as PEM, PEM with escaped newlines, or its base64", () => {
    for (const key of [pem, pem.replaceAll("\n", "\\n"), Buffer.from(pem).toString("base64")]) {
      const config = parseMoneyConfig({ ENABLE_BANKING_APP_ID: "app-id", ENABLE_BANKING_PRIVATE_KEY: key });

      expect(config.enableBanking?.appId).toBe("app-id");
      expect(config.enableBanking?.privateKey.export({ type: "pkcs8", format: "pem" })).toBe(pem);
    }
  });

  test("refuses half a configuration, or a key that is not one", () => {
    expect(() => parseMoneyConfig({ ENABLE_BANKING_APP_ID: "app-id" })).toThrow("together, or neither");
    expect(() => parseMoneyConfig({ ENABLE_BANKING_APP_ID: "app-id", ENABLE_BANKING_PRIVATE_KEY: "bm9wZQ==" })).toThrow(
      "not a PEM private key",
    );
  });
});
