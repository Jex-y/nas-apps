import { installShell } from "@nas/core/web";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router, Switch } from "wouter";
import { Layout } from "./components/Layout";
import { DestinationsPage } from "./features/destinations/components/DestinationsPage";
import { MapPage } from "./features/map/components/MapPage";
import { BoardPage } from "./features/properties/components/BoardPage";
import { InboxPage } from "./features/properties/components/InboxPage";
import { PropertyPage } from "./features/properties/components/PropertyPage";
import { RejectedPage } from "./features/properties/components/RejectedPage";
import { SwipePage } from "./features/properties/components/SwipePage";
import { SearchesPage } from "./features/searches/components/SearchesPage";
import { queryClient } from "./lib/query-client";

void installShell();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router base="/flats">
        <Layout>
          <Switch>
            <Route path="/" component={InboxPage} />
            <Route path="/swipe" component={SwipePage} />
            <Route path="/board" component={BoardPage} />
            <Route path="/rejected" component={RejectedPage} />
            <Route path="/map" component={MapPage} />
            <Route path="/searches" component={SearchesPage} />
            <Route path="/commutes" component={DestinationsPage} />
            <Route path="/properties/:id">{(params) => <PropertyPage id={params.id} />}</Route>
            <Route>
              <p className="muted">Nothing here.</p>
            </Route>
          </Switch>
        </Layout>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
