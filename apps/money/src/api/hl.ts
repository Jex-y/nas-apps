import { penceOf } from "../pence";
import { parseCsv } from "./csv";

export type HlHolding = {
  readonly code: string;
  readonly name: string;
  readonly units: number;
  /** Pence per unit. */
  readonly price: number;
  readonly cost: number | null;
};

export type HlTransaction = {
  readonly tradedOn: string;
  /** `B…` and `S…` contract numbers for trades, else a kind such as `MANAGE FEE`; not unique. */
  readonly reference: string;
  readonly description: string;
  readonly amount: number;
};

export type HlExport =
  | {
      readonly kind: "holdings";
      /** As the file's first line names it, e.g. "HL Stocks & Shares ISA". */
      readonly account: string;
      /** The day the file was made; `null` when it does not say. */
      readonly asOf: string | null;
      readonly cash: number;
      readonly holdings: readonly HlHolding[];
    }
  | { readonly kind: "transactions"; readonly transactions: readonly HlTransaction[] };

/** The file is not a Hargreaves Lansdown export this reads; the message says what was expected. */
export class HlParseError extends Error {}

const clean = (cell: string | undefined) => (cell ?? "").trim();
const label = (cell: string | undefined) => clean(cell).toLowerCase().replace(/:$/, "");

/** `21-09-2026 19:11` or `21/09/2026` to `2026-09-21`. */
const isoDate = (value: string): string | null => {
  const match = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(value.trim());
  return match === null ? null : `${match[3]}-${match[2]}-${match[1]}`;
};

const numberOf = (cell: string | undefined): number | null => {
  const value = clean(cell).replaceAll(",", "");
  return value === "" || Number.isNaN(Number(value)) ? null : Number(value);
};

/** Each wanted column's index, by how its heading starts, so a mangled `£` in a heading does not matter. */
const columns = <K extends string>(
  header: readonly string[],
  wanted: Readonly<Record<K, string>>,
): Record<K, number> => {
  const headings = header.map(label);
  const found = Object.entries<string>(wanted).map(([key, start]) => {
    const index = headings.findIndex((heading) => heading.startsWith(start));
    if (index === -1) {
      throw new HlParseError(`The export has no "${start}" column`);
    }
    return [key, index];
  });
  return Object.fromEntries(found) as Record<K, number>;
};

const parseHoldings = (rows: readonly string[][], headerAt: number): HlExport => {
  const preamble = rows.slice(0, headerAt);
  const stated = (start: string) => preamble.find((row) => label(row[0]).startsWith(start))?.[1];
  const at = columns(rows[headerAt] ?? [], {
    code: "code",
    name: "stock",
    units: "units",
    price: "price",
    value: "value",
    cost: "cost",
  });

  const held = rows.slice(headerAt + 1).flatMap((row) => {
    const [code, name] = [clean(row[at.code]), clean(row[at.name])];
    const [units, price, value] = [numberOf(row[at.units]), numberOf(row[at.price]), penceOf(clean(row[at.value]))];
    return code === "" || name === "" || units === null || price === null || value === null
      ? []
      : [{ holding: { code, name, units, price, cost: penceOf(clean(row[at.cost])) }, value }];
  });

  const invested = held.reduce((sum, { value }) => sum + value, 0);
  const total = penceOf(clean(stated("total value")));
  return {
    kind: "holdings",
    account: clean(rows[0]?.[0]) || "Hargreaves Lansdown",
    asOf: isoDate(clean(stated("spreadsheet created at") ?? stated("valuation as at"))),
    cash: total === null ? (penceOf(clean(stated("total cash"))) ?? 0) : total - invested,
    holdings: held.map(({ holding }) => holding),
  };
};

const parseTransactions = (rows: readonly string[][], headerAt: number): HlExport => {
  const at = columns(rows[headerAt] ?? [], {
    tradedOn: "trade date",
    reference: "reference",
    description: "description",
    amount: "value",
  });
  return {
    kind: "transactions",
    transactions: rows.slice(headerAt + 1).flatMap((row) => {
      const [tradedOn, amount] = [isoDate(clean(row[at.tradedOn])), penceOf(clean(row[at.amount]))];
      return tradedOn === null || amount === null
        ? []
        : [{ tradedOn, reference: clean(row[at.reference]), description: clean(row[at.description]), amount }];
    }),
  };
};

/**
 * Reads an account's holdings (Account summary → Download) or its transaction history, telling them apart by their
 * column headings. Rows it cannot read, such as the totals line, are skipped.
 */
export const parseHlExport = (csv: string): HlExport => {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headed = (first: string) => rows.findIndex((row) => label(row[0]) === first);
  const [holdingsAt, transactionsAt] = [headed("code"), headed("trade date")];
  if (holdingsAt !== -1) {
    return parseHoldings(rows, holdingsAt);
  }
  if (transactionsAt !== -1) {
    return parseTransactions(rows, transactionsAt);
  }
  throw new HlParseError(
    'Not a Hargreaves Lansdown export: expected a holdings table starting "Code" or a history starting "Trade date"',
  );
};
