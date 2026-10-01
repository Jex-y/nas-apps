import { installShell } from "@apps/core/web";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router, Switch } from "wouter";
import { Layout } from "./components/Layout";
import { ActivitiesPage } from "./features/activities/components/ActivitiesPage";
import { ConnectPage } from "./features/connect/components/ConnectPage";
import { MapPage } from "./features/map/components/MapPage";
import { StatsPage } from "./features/stats/components/StatsPage";
import { SuggestPage } from "./features/suggestions/components/SuggestPage";
import { queryClient } from "./lib/query-client";

void installShell();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router base="/streets">
        <Layout>
          <Switch>
            <Route path="/" component={MapPage} />
            <Route path="/stats" component={StatsPage} />
            <Route path="/suggest" component={SuggestPage} />
            <Route path="/activities" component={ActivitiesPage} />
            <Route path="/connect" component={ConnectPage} />
            <Route>
              <p className="muted">Nothing here.</p>
            </Route>
          </Switch>
        </Layout>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
