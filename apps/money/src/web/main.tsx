import { installShell } from "@apps/core/web";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { Layout } from "./components/Layout";
import { Pages } from "./components/Pages";
import { queryClient } from "./lib/query-client";

void installShell();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router base="/money">
        <Layout>
          <Pages />
        </Layout>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
