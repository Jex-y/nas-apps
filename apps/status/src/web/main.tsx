import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StatusPage } from "./features/status/components/StatusPage";

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <StatusPage />
    </QueryClientProvider>
  </StrictMode>,
);
