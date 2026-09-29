import { installShell } from "@nas/core/web";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router, Switch } from "wouter";
import { Layout } from "./components/Layout";
import { ProjectLayout } from "./features/projects/components/ProjectLayout";
import { ProjectsPage } from "./features/projects/components/ProjectsPage";
import { queryClient } from "./lib/query-client";
import { BASE } from "./lib/routes";

void installShell();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router base={BASE}>
        <Layout>
          <Switch>
            <Route path="/" component={ProjectsPage} />
            <Route path="/:projectId" nest>
              {({ projectId }) => <ProjectLayout projectId={projectId} />}
            </Route>
          </Switch>
        </Layout>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
