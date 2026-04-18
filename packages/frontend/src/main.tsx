import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "@/components/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { TooltipProvider } from "@vivd/ui";

import { AppConfigProvider } from "@/lib/AppConfigContext";
import { ROUTES } from "@/app/router";

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 2, // 2 minutes
            refetchOnWindowFocus: false, // Prevent refetch on tab switch
            retry: 1, // Single retry on failure
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        splitLink({
          // Route subscriptions through SSE, everything else through batch HTTP
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({
            url: ROUTES.API_TRPC,
            // EventSource will auto-reconnect on disconnect
          }),
          false: httpBatchLink({
            url: ROUTES.API_TRPC,
            async headers() {
              return {};
            },
            fetch(url, options) {
              return fetch(url, {
                ...options,
                credentials: "include",
              });
            },
          }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppConfigProvider>
          <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ThemeProvider>
        </AppConfigProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
