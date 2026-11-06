import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ApiError } from "./api";
import { ToastProvider } from "./components/ui";
import { LangProvider } from "./i18n";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // The app is served by the room PC, so it can be reached when the browser
    // thinks it's offline. The default would freeze until the internet is back.
    queries: {
      networkMode: "always",
      staleTime: 10_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
    mutations: { networkMode: "always" },
  },
});

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LangProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </LangProvider>
    </StrictMode>,
  );
}
