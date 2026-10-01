import { type FormEvent, useState } from "react";
import type { Account, AccountList, Holding } from "../../../../contract";
import { formatDate, formatPence, formatSigned } from "../../../utils/format";
import { useHoldings, useSetSymbol } from "../api/holdings";
import { ImportForm } from "./ImportForm";

const units = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 4 });
const price = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const percent = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** The FT Markets symbol a holding is repriced from, editable in place; empty stops repricing it. */
const SymbolForm = ({ holding }: { holding: Holding }) => {
  const setSymbol = useSetSymbol();
  const [value, setValue] = useState(holding.symbol ?? "");
  const symbol = value.trim() === "" ? null : value.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSymbol.mutate({ code: holding.code, symbol });
  };

  return (
    <form className="symbol-form" onSubmit={submit}>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="e.g. GB00B59G4Q73:GBP"
        aria-label={`FT Markets symbol for ${holding.name}`}
        maxLength={40}
      />
      {symbol !== holding.symbol && (
        <button type="submit" disabled={setSymbol.isPending}>
          {setSymbol.isPending ? "Pricing…" : "Save"}
        </button>
      )}
      {setSymbol.error && <span className="error">{setSymbol.error.message}</span>}
    </form>
  );
};

const Portfolio = ({ account, holdings }: { account: Account; holdings: readonly Holding[] }) => (
  <section className="panel">
    <header className="card-heading">
      <div>
        <h2>{account.name}</h2>
        {account.feed.kind === "portfolio" && (
          <p className="muted">
            Exported {formatDate(account.feed.importedOn)} · {formatPence(account.feed.cash)} cash
          </p>
        )}
      </div>
      <span className="amount">{account.balance === null ? "—" : formatPence(account.balance.amount)}</span>
    </header>
    <div className="scroll">
      <table className="figures holdings">
        <thead>
          <tr>
            <th scope="col">Investment</th>
            <th scope="col" className="amount">
              Units
            </th>
            <th scope="col" className="amount">
              Price (p)
            </th>
            <th scope="col" className="amount">
              Value
            </th>
            <th scope="col" className="amount">
              Gain
            </th>
            <th scope="col">FT symbol</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const gain = holding.cost === null ? null : holding.value - holding.cost;
            return (
              <tr key={holding.code}>
                <th scope="row">
                  {holding.name}
                  <span className="muted"> {holding.code}</span>
                </th>
                <td className="amount">{units.format(holding.units)}</td>
                <td className="amount">
                  {price.format(holding.price)}
                  <br />
                  <time className="muted" dateTime={holding.pricedOn}>
                    {formatDate(holding.pricedOn)}
                  </time>
                </td>
                <td className="amount">{formatPence(holding.value)}</td>
                <td className="amount">
                  {gain === null || holding.cost === null ? (
                    "—"
                  ) : (
                    <>
                      {formatSigned(gain)}
                      <br />
                      <span className="muted">{holding.cost === 0 ? "" : percent.format(gain / holding.cost)}</span>
                    </>
                  )}
                </td>
                <td>
                  <SymbolForm key={holding.symbol} holding={holding} />
                  {holding.symbol === null && <span className="badge warning">Not repriced</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </section>
);

export const HoldingsPage = ({ accounts }: { accounts: AccountList }) => {
  const holdings = useHoldings();
  const byAccount = Map.groupBy(holdings.data ?? [], (holding) => holding.accountId);
  const portfolios = accounts.filter((account) => account.feed.kind === "portfolio");

  return (
    <section>
      <h1>Holdings</h1>
      {holdings.error && <p className="error">{holdings.error.message}</p>}
      {portfolios.map((account) => (
        <Portfolio key={account.id} account={account} holdings={byAccount.get(account.id) ?? []} />
      ))}
      <h2>Import from Hargreaves Lansdown</h2>
      <p className="muted">
        On an account's summary page in HL, choose Download to get its holdings as a CSV; importing it replaces what
        that account held here. A transaction history CSV adds to the account you choose. Each investment is matched to
        its FT Markets listing and repriced every day; set the symbol yourself where no match was found.
      </p>
      <ImportForm accounts={accounts} />
    </section>
  );
};
