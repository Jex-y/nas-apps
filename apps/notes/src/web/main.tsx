import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotesPage } from "./features/notes/components/NotesPage";

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <NotesPage />
    </QueryClientProvider>
  </StrictMode>,
);
