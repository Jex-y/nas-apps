import type { NewLineItem, Transaction } from "../../../../contract";
import { penceOf } from "../../../../pence";

/** A line item as it is being typed. Amounts are in the transaction's own direction, so a purchase's are positive. */
export type DraftItem = {
  /** Identifies the row while it is edited; never sent. */
  readonly key: string;
  readonly description: string;
  readonly amount: string;
  readonly tags: readonly string[];
};

const direction = (transaction: Transaction): 1 | -1 => (transaction.amount < 0 ? -1 : 1);

const inPounds = (pence: number): string => (pence / 100).toFixed(2);

export const draftOf = (transaction: Transaction): DraftItem[] =>
  transaction.items.map((item) => ({
    key: item.id,
    description: item.description,
    amount: inPounds(item.amount * direction(transaction)),
    tags: item.tags,
  }));

/** The line items to save; `null` while any amount is not a number. */
export const itemsOf = (transaction: Transaction, draft: readonly DraftItem[]): NewLineItem[] | null => {
  const items = draft.map(({ description, amount, tags }) => {
    const pence = penceOf(amount);
    return pence === null ? null : { description, amount: pence * direction(transaction), tags: [...tags] };
  });
  return items.every((item) => item !== null) ? items : null;
};

/** How much of the transaction no line accounts for, in its own direction; `null` while any amount is not a number. */
export const remainderOf = (transaction: Transaction, draft: readonly DraftItem[]): number | null => {
  const items = itemsOf(transaction, draft);
  const accounted = items?.reduce((sum, item) => sum + item.amount * direction(transaction), 0);
  return accounted === undefined ? null : Math.abs(transaction.amount) - accounted;
};

/** A new line for whatever is left over, or an empty one when nothing is. */
export const nextLine = (transaction: Transaction, draft: readonly DraftItem[], key: string): DraftItem => {
  const left = remainderOf(transaction, draft);
  return { key, description: "", amount: left === null || left === 0 ? "" : inPounds(left), tags: [] };
};

/** A tag as the server will keep it, or `null` when nothing was typed. */
export const tagOf = (text: string): string | null => {
  const name = text.trim().toLowerCase().slice(0, 40);
  return name === "" ? null : name;
};
