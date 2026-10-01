import { useState } from "react";
import type { MonthSpending } from "../../../../contract";
import { formatMonth, formatPence, formatSigned } from "../../../utils/format";
import { useSpending } from "../api/spending";

const RANGES = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
] as const;

/**
 * A month's tags, biggest outgoing first, each with a bar of its size against the month's largest. Tags that net to
 * money in sit at the end without a bar, since the bars measure spending.
 */
const Month = ({ month }: { month: MonthSpending }) => {
  const largest = Math.max(1, ...month.byTag.map(({ amount }) => -amount));

  return (
    <section className="panel month">
      <header className="card-heading">
        <h2>{formatMonth(month.month)}</h2>
        <dl className="stats">
          <div>
            <dt>In</dt>
            <dd>{formatPence(month.income)}</dd>
          </div>
          <div>
            <dt>Out</dt>
            <dd>{formatPence(-month.outgoings)}</dd>
          </div>
          <div>
            <dt>Net</dt>
            <dd>{formatSigned(month.income + month.outgoings)}</dd>
          </div>
        </dl>
      </header>
      <table className="figures">
        <tbody>
          {month.byTag.map(({ tag, amount }) => (
            <tr key={tag ?? ""} title={`${tag ?? "Untagged"}: ${formatSigned(amount)}`}>
              <th scope="row" className={tag === null ? "tag-cell muted" : "tag-cell"}>
                {tag ?? "Untagged"}
              </th>
              <td className="bar-cell">
                {amount < 0 && <span className="bar" style={{ width: `${(-amount / largest) * 100}%` }} />}
              </td>
              <td className="amount">{formatSigned(amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

export const SpendingPage = () => {
  const [months, setMonths] = useState<number>(6);
  const spending = useSpending(months);

  return (
    <section>
      <h1>Spending</h1>
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
      <p className="muted">
        What came into and went out of your cash accounts each month, by tag. A line item with several tags counts under
        each.
      </p>
      {spending.error && <p className="error">{spending.error.message}</p>}
      {spending.isPending && <p className="muted">Loading…</p>}
      {spending.data?.length === 0 && <p className="muted">No transactions in cash accounts yet.</p>}
      <div className={spending.isPlaceholderData ? "stale" : undefined}>
        {spending.data?.map((month) => (
          <Month key={month.month} month={month} />
        ))}
      </div>
    </section>
  );
};
