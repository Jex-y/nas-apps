import { installShell } from "@apps/core/web";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { Layout } from "./components/Layout";
import { Pages } from "./components/Pages";
import { StoreContext } from "./hooks/useStore";
import { openStore } from "./lib/store";

void installShell();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

const store = await openStore();

createRoot(root).render(
  <StrictMode>
    <StoreContext value={store}>
      <Router base="/lifts">
        <Layout>
          <Pages />
        </Layout>
      </Router>
    </StoreContext>
  </StrictMode>,
);
