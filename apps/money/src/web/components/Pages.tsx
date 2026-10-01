import { Route, Switch } from "wouter";
import { useAccounts } from "../features/accounts/api/accounts";
import { AccountsPage } from "../features/accounts/components/AccountsPage";
import { HoldingsPage } from "../features/holdings/components/HoldingsPage";
import { OverviewPage } from "../features/overview/components/OverviewPage";
import { SpendingPage } from "../features/spending/components/SpendingPage";
import { TransactionsPage } from "../features/transactions/components/TransactionsPage";

/** Every view names or totals the accounts, so they are loaded once here and handed down. */
export const Pages = () => {
  const accounts = useAccounts();

  if (accounts.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (accounts.error) {
    return <p className="error">{accounts.error.message}</p>;
  }
  return (
    <Switch>
      <Route path="/">
        <OverviewPage accounts={accounts.data} />
      </Route>
      <Route path="/transactions">
        <TransactionsPage accounts={accounts.data} />
      </Route>
      <Route path="/spending">
        <SpendingPage />
      </Route>
      <Route path="/holdings">
        <HoldingsPage accounts={accounts.data} />
      </Route>
      <Route path="/accounts">
        <AccountsPage accounts={accounts.data} />
      </Route>
      <Route>
        <p className="muted">Nothing here.</p>
      </Route>
    </Switch>
  );
};
