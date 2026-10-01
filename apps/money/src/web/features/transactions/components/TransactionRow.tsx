import { useState } from "react";
import type { Transaction } from "../../../../contract";
import { formatPence } from "../../../utils/format";
import { SplitEditor } from "./SplitEditor";

type Props = {
  readonly transaction: Transaction;
  readonly accountName: string;
  readonly knownTags: readonly string[];
};

export const TransactionRow = ({ transaction, accountName, knownTags }: Props) => {
  const [editing, setEditing] = useState(false);
  const split = transaction.items.length > 1;
  const tags = [...new Set(transaction.items.flatMap((item) => item.tags))];

  return (
    <li className={editing ? "transaction editing" : "transaction"}>
      <button
        type="button"
        className="transaction-summary"
        aria-expanded={editing}
        onClick={() => setEditing(!editing)}
      >
        <span className="transaction-what">
          <span className="transaction-title">
            {transaction.description || transaction.counterparty || "Transaction"}
          </span>
          <span className="muted">
            {accountName}
            {split && ` · ${transaction.items.length} line items`}
          </span>
          {tags.length > 0 && (
            <span className="chips">
              {tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className={transaction.amount > 0 ? "amount credit" : "amount"}>{formatPence(transaction.amount)}</span>
      </button>
      {split && !editing && (
        <ul className="line-items">
          {transaction.items.map((item) => (
            <li key={item.id}>
              <span>
                {item.description || "Unnamed"}
                {item.tags.map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
              </span>
              <span className="amount">{formatPence(item.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {editing && <SplitEditor transaction={transaction} knownTags={knownTags} onDone={() => setEditing(false)} />}
    </li>
  );
};
