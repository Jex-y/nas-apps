import { type FormEvent, useState } from "react";
import type { Transaction } from "../../../../contract";
import { formatPence } from "../../../utils/format";
import { useSplitTransaction } from "../api/transactions";
import { type DraftItem, draftOf, itemsOf, nextLine, remainderOf } from "../utils/split";
import { TagInput } from "./TagInput";

type Props = {
  readonly transaction: Transaction;
  readonly knownTags: readonly string[];
  readonly onDone: () => void;
};

/**
 * Edits a transaction's line items: one line tags the whole of it, more break it down. It saves only once the lines
 * add up to the transaction.
 */
export const SplitEditor = ({ transaction, knownTags, onDone }: Props) => {
  const split = useSplitTransaction();
  const [draft, setDraft] = useState<readonly DraftItem[]>(() => draftOf(transaction));
  const whole = draft.length === 1;
  const items = itemsOf(transaction, draft);
  const remainder = remainderOf(transaction, draft);

  const change = (key: string, fields: Partial<DraftItem>) =>
    setDraft((lines) => lines.map((line) => (line.key === key ? { ...line, ...fields } : line)));

  /** The new line takes whatever the others leave over. */
  const addLine = () => setDraft((lines) => [...lines, nextLine(transaction, lines, crypto.randomUUID())]);

  /** Back to one line, it takes the whole amount again. */
  const removeLine = (key: string) =>
    setDraft((lines) => {
      const kept = lines.filter((line) => line.key !== key);
      const [only] = kept;
      return kept.length === 1 && only !== undefined
        ? [{ ...only, amount: (Math.abs(transaction.amount) / 100).toFixed(2) }]
        : kept;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (items !== null && remainder === 0) {
      split.mutate({ transactionId: transaction.id, split: { items } }, { onSuccess: onDone });
    }
  };

  return (
    <form className="split" onSubmit={submit}>
      <ul>
        {draft.map((line, index) => (
          <li key={line.key} className="split-line">
            {!whole && (
              <>
                <input
                  value={line.description}
                  onChange={(event) => change(line.key, { description: event.target.value })}
                  placeholder={`Line ${index + 1}`}
                  aria-label={`Line ${index + 1} description`}
                  maxLength={200}
                />
                <label className="field">
                  £
                  <input
                    className="amount amount-input short"
                    value={line.amount}
                    onChange={(event) => change(line.key, { amount: event.target.value })}
                    inputMode="decimal"
                    aria-label={`Line ${index + 1} amount in pounds`}
                    required
                  />
                </label>
              </>
            )}
            <TagInput
              tags={line.tags}
              onChange={(tags) => change(line.key, { tags })}
              known={knownTags}
              label={whole ? "Tags" : `Line ${index + 1} tags`}
            />
            {!whole && (
              <button
                type="button"
                className="quiet"
                aria-label={`Remove line ${index + 1}`}
                onClick={() => removeLine(line.key)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" onClick={addLine} disabled={draft.length >= 50}>
          {whole ? "Break into line items" : "Add a line"}
        </button>
        {!whole && remainder !== null && remainder !== 0 && (
          <span className="badge warning">
            {remainder > 0 ? `${formatPence(remainder)} left to account for` : `${formatPence(-remainder)} over`}
          </span>
        )}
        <span className="push" />
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={items === null || remainder !== 0 || split.isPending}>
          Save
        </button>
      </div>
      {split.error && <p className="error">{split.error.message}</p>}
    </form>
  );
};
