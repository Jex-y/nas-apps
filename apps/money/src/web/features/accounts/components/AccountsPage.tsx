import { useSearch } from "wouter";
import type { AccountList } from "../../../../contract";
import { AccountCard } from "./AccountCard";
import { BankSection } from "./BankSection";
import { NewAccountForm } from "./NewAccountForm";

/** How a bank login went, which its redirect back carries in the query string. */
const LoginOutcome = () => {
  const params = new URLSearchParams(useSearch());
  const error = params.get("error");
  if (error !== null) {
    return (
      <p className="notice error" role="alert">
        The bank was not linked: {error}
      </p>
    );
  }
  return params.has("linked") ? (
    <p className="notice" role="status">
      Bank linked. Its transactions are being read now and will appear shortly.
    </p>
  ) : null;
};

export const AccountsPage = ({ accounts }: { accounts: AccountList }) => (
  <section>
    <LoginOutcome />
    <h1>Accounts</h1>
    {accounts.length === 0 && (
      <p className="muted">
        Nothing yet. Link a bank, import a Hargreaves Lansdown export from Holdings, or add anything else you own or owe
        by hand.
      </p>
    )}
    <ul className="cards">
      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}
    </ul>
    <h2>Add by hand</h2>
    <NewAccountForm />
    <BankSection />
  </section>
);
