import { installShell } from "@apps/core/web";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router, Switch } from "wouter";
import { Layout } from "./components/Layout";
import { ConnectPage } from "./features/health/components/ConnectPage";
import { HistoryPage } from "./features/history/components/HistoryPage";
import { HomePage } from "./features/pet/components/HomePage";
import { SettingsPage } from "./features/settings/components/SettingsPage";
import { queryClient } from "./lib/query-client";

void installShell();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router base="/pet">
        <Layout>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/history" component={HistoryPage} />
            <Route path="/health" component={ConnectPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route>
              <p className="muted">Nothing here.</p>
            </Route>
          </Switch>
        </Layout>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
