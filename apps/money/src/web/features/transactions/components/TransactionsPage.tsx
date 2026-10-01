import { useState } from "react";
import type { AccountList, TagFilter } from "../../../../contract";
import { formatDay } from "../../../utils/format";
import { useTags, useTransactions } from "../api/transactions";
import { useDebounced } from "../hooks/useDebounced";
import { TagManager } from "./TagManager";
import { TransactionRow } from "./TransactionRow";

const ANY = "any";
const UNTAGGED = "untagged";
const TAG_PREFIX = "tag:";

/** The tag select's value, where a prefix keeps a tag named "any" apart from the option for all of them. */
const tagFilterOf = (value: string): TagFilter =>
  value.startsWith(TAG_PREFIX)
    ? { kind: "tagged", name: value.slice(TAG_PREFIX.length) }
    : value === UNTAGGED
      ? { kind: "untagged" }
      : { kind: "any" };

export const TransactionsPage = ({ accounts }: { accounts: AccountList }) => {
  const [accountId, setAccountId] = useState("");
  const [tagValue, setTagValue] = useState(ANY);
  const [search, setSearch] = useState("");
  const settledSearch = useDebounced(search.trim(), 250);
  const tags = useTags();
  const transactions = useTransactions({
    accountId: accountId === "" ? null : accountId,
    tags: tagFilterOf(tagValue),
    search: settledSearch === "" ? null : settledSearch,
  });

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const knownTags = (tags.data ?? []).map((tag) => tag.name);
  const loaded = transactions.data?.pages.flatMap((page) => page.transactions) ?? [];
  const days = Map.groupBy(loaded, (transaction) => transaction.bookedOn);

  return (
    <section>
      <h1>Transactions</h1>
      <div className="filters">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          aria-label="Search transactions"
          maxLength={100}
        />
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <select value={tagValue} onChange={(event) => setTagValue(event.target.value)} aria-label="Tag">
          <option value={ANY}>All tags</option>
          <option value={UNTAGGED}>Untagged</option>
          {knownTags.map((tag) => (
            <option key={tag} value={`${TAG_PREFIX}${tag}`}>
              {tag}
            </option>
          ))}
        </select>
      </div>
      {transactions.error && <p className="error">{transactions.error.message}</p>}
      {transactions.isPending && <p className="muted">Loading…</p>}
      {transactions.isSuccess && loaded.length === 0 && (
        <p className="muted">No transactions match. They arrive once a bank is linked or a history is imported.</p>
      )}
      <div className={transactions.isPlaceholderData ? "stale" : undefined}>
        {[...days].map(([day, booked]) => (
          <section key={day} className="day">
            <h2>
              <time dateTime={day}>{formatDay(day)}</time>
            </h2>
            <ul className="panel transactions">
              {booked.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  accountName={accountNames.get(transaction.accountId) ?? ""}
                  knownTags={knownTags}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {transactions.hasNextPage && (
        <button type="button" onClick={() => transactions.fetchNextPage()} disabled={transactions.isFetchingNextPage}>
          {transactions.isFetchingNextPage ? "Loading…" : "Show earlier"}
        </button>
      )}
      <TagManager tags={tags.data ?? []} />
    </section>
  );
};
