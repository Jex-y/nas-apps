import { installShell } from "@apps/core/web";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router, Switch } from "wouter";
import { Layout } from "./components/Layout";
import { DestinationsPage } from "./features/destinations/components/DestinationsPage";
import { BoardPage } from "./features/properties/components/BoardPage";
import { InboxPage } from "./features/properties/components/InboxPage";
import { PropertyPage } from "./features/properties/components/PropertyPage";
import { RejectedPage } from "./features/properties/components/RejectedPage";
import { SwipePage } from "./features/properties/components/SwipePage";
import { RequirementsPage } from "./features/requirements/components/RequirementsPage";
import { SearchesPage } from "./features/searches/components/SearchesPage";
import { queryClient } from "./lib/query-client";

/** Loaded only when opened: the map library is several times the size of everything else. */
const MapPage = lazy(async () => ({ default: (await import("./features/map/components/MapPage")).MapPage }));

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
            <Route path="/searches" component={SearchesPage} />
            <Route path="/commutes" component={DestinationsPage} />
            <Route path="/requirements" component={RequirementsPage} />
            <Route path="/map">
              <Suspense fallback={<p className="muted">Loading the map…</p>}>
                <MapPage />
              </Suspense>
            </Route>
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
