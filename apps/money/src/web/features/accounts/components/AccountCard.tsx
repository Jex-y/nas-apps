import { type FormEvent, useState } from "react";
import { type Account, type Feed, KINDS, type Kind } from "../../../../contract";
import { penceOf } from "../../../../pence";
import { formatDate, formatPence, KIND_LABELS, today } from "../../../utils/format";
import { useBalances, useDeleteAccount, useDeleteBalance, useSetBalance, useUpdateAccount } from "../api/accounts";

const describeFeed = (feed: Feed): string => {
  switch (feed.kind) {
    case "bank":
      return `Read from ${feed.institution}`;
    case "portfolio":
      return `Holdings as exported on ${formatDate(feed.importedOn)}, repriced daily · ${formatPence(feed.cash)} cash`;
    case "manual":
      return "Kept by hand";
  }
};

const SetBalanceForm = ({ account }: { account: Account }) => {
  const setBalance = useSetBalance();
  const [date, setDate] = useState(today);
  const [value, setValue] = useState("");
  const amount = penceOf(value);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (amount !== null) {
      setBalance.mutate({ accountId: account.id, date, amount }, { onSuccess: () => setValue("") });
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="field">
        Worth £
        <input
          className="amount-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          placeholder={account.kind === "debt" ? "-250,000" : "0.00"}
          aria-label={`What ${account.name} is worth, in pounds; negative if owed`}
          required
        />
      </label>
      <label className="field">
        on
        <input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} required />
      </label>
      <button type="submit" disabled={amount === null || setBalance.isPending}>
        Record
      </button>
      {setBalance.error && <span className="error">{setBalance.error.message}</span>}
    </form>
  );
};

const History = ({ account }: { account: Account }) => {
  const balances = useBalances(account.id);
  const remove = useDeleteBalance();
  const manual = account.feed.kind === "manual";

  if (balances.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (balances.error) {
    return <p className="error">{balances.error.message}</p>;
  }
  return (
    <>
      {balances.data.length === 0 && <p className="muted">No balance recorded yet.</p>}
      <table className="figures history">
        <tbody>
          {balances.data.slice(0, 24).map((balance) => (
            <tr key={balance.on}>
              <td>
                <time dateTime={balance.on}>{formatDate(balance.on)}</time>
              </td>
              <td className="amount">{formatPence(balance.amount)}</td>
              {manual && (
                <td>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Remove the balance for ${formatDate(balance.on)}`}
                    onClick={() => remove.mutate({ accountId: account.id, date: balance.on })}
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {balances.data.length > 24 && <p className="muted">And {balances.data.length - 24} earlier.</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </>
  );
};

const Settings = ({ account }: { account: Account }) => {
  const update = useUpdateAccount();
  const remove = useDeleteAccount();
  const [name, setName] = useState(account.name);

  const rename = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ accountId: account.id, update: { name } });
  };
  const confirmDelete = () => {
    if (window.confirm(`Delete ${account.name} with all its balances and transactions?`)) {
      remove.mutate(account.id);
    }
  };

  return (
    <form className="inline-form" onSubmit={rename}>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Name"
        maxLength={100}
        required
      />
      <select
        value={account.kind}
        onChange={(event) => update.mutate({ accountId: account.id, update: { kind: event.target.value as Kind } })}
        aria-label="Kind"
      >
        {KINDS.map((option) => (
          <option key={option} value={option}>
            {KIND_LABELS[option]}
          </option>
        ))}
      </select>
      <button type="submit" disabled={update.isPending || name.trim() === account.name}>
        Rename
      </button>
      <button type="button" className="danger" onClick={confirmDelete} disabled={remove.isPending}>
        Delete
      </button>
      {(update.error ?? remove.error) && <span className="error">{(update.error ?? remove.error)?.message}</span>}
    </form>
  );
};

export const AccountCard = ({ account }: { account: Account }) => {
  const [open, setOpen] = useState(false);

  return (
    <li className="card">
      <div className="card-heading">
        <div>
          <h3>{account.name}</h3>
          <p className="muted">
            <span className="badge">{KIND_LABELS[account.kind]}</span> {describeFeed(account.feed)}
          </p>
        </div>
        <div className="card-figure">
          <span className="amount">{account.balance === null ? "—" : formatPence(account.balance.amount)}</span>
          {account.balance !== null && (
            <time className="muted" dateTime={account.balance.on}>
              {formatDate(account.balance.on)}
            </time>
          )}
        </div>
      </div>
      {account.feed.kind === "manual" && <SetBalanceForm account={account} />}
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>History and settings</summary>
        {open && (
          <>
            <Settings account={account} />
            <History account={account} />
          </>
        )}
      </details>
    </li>
  );
};
