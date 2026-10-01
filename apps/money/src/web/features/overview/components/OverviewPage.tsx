import { useState } from "react";
import { Link } from "wouter";
import { type AccountList, KINDS } from "../../../../contract";
import { formatDate, formatPence, formatPounds, formatSigned, KIND_LABELS, today } from "../../../utils/format";
import { useNetWorth } from "../api/net-worth";
import { totalOf } from "../utils/chart";
import { NetWorthChart } from "./NetWorthChart";

const RANGES = [
  { months: 3, label: "3 months" },
  { months: 12, label: "1 year" },
  { months: 60, label: "5 years" },
  { months: 240, label: "All" },
] as const;

const sum = (amounts: readonly number[]) => amounts.reduce((total, amount) => total + amount, 0);

const AccountsTable = ({ accounts }: { accounts: AccountList }) => (
  <table className="figures">
    {KINDS.map((kind) => {
      const held = accounts.filter((account) => account.kind === kind);
      return held.length === 0 ? null : (
        <tbody key={kind}>
          <tr className="group">
            <th scope="rowgroup">{KIND_LABELS[kind]}</th>
            <td className="amount">{formatPence(sum(held.map((account) => account.balance?.amount ?? 0)))}</td>
          </tr>
          {held.map((account) => (
            <tr key={account.id}>
              <td>
                {account.name}
                {account.balance !== null && account.balance.on !== today() && (
                  <span className="muted"> as of {formatDate(account.balance.on)}</span>
                )}
              </td>
              <td className="amount">{account.balance === null ? "—" : formatPence(account.balance.amount)}</td>
            </tr>
          ))}
        </tbody>
      );
    })}
  </table>
);

export const OverviewPage = ({ accounts }: { accounts: AccountList }) => {
  const [months, setMonths] = useState<number>(12);
  const netWorth = useNetWorth(months);
  const total = sum(accounts.map((account) => account.balance?.amount ?? 0));
  const series = netWorth.data ?? [];
  const [first, last] = [series[0], series.at(-1)];
  const change = first === undefined || last === undefined ? 0 : totalOf(last) - totalOf(first);

  if (accounts.length === 0) {
    return (
      <section>
        <h1>Net worth</h1>
        <p className="muted">
          Nothing to add up yet. <Link href="/accounts">Link a bank or add an account</Link> to start.
        </p>
      </section>
    );
  }
  return (
    <section>
      <header className="hero">
        <p className="label">Net worth</p>
        <p className="hero-figure">{formatPounds(total)}</p>
        {first !== undefined && series.length > 1 && (
          <p className="muted">
            <span className={change < 0 ? "direction down" : "direction up"} aria-hidden="true">
              {change < 0 ? "▼" : "▲"}
            </span>{" "}
            {formatSigned(change)} since <time dateTime={first.date}>{formatDate(first.date)}</time>
          </p>
        )}
      </header>
      <fieldset className="segmented">
        <legend className="visually-hidden">Range</legend>
        {RANGES.map((range) => (
          <label key={range.months}>
            <input
              type="radio"
              name="range"
              checked={months === range.months}
              onChange={() => setMonths(range.months)}
            />
            {range.label}
          </label>
        ))}
      </fieldset>
      {netWorth.error && <p className="error">{netWorth.error.message}</p>}
      {series.length > 0 && (
        <div className={netWorth.isPlaceholderData ? "panel stale" : "panel"}>
          <NetWorthChart series={series} />
        </div>
      )}
      <div className="panel">
        <AccountsTable accounts={accounts} />
      </div>
    </section>
  );
};
