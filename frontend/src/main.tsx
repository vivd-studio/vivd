import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppConfigProvider } from "@/lib/AppConfigContext";

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        splitLink({
          // Route subscriptions through SSE, everything else through batch HTTP
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({
            url: "/vivd-studio/api/trpc",
            // EventSource will auto-reconnect on disconnect
          }),
          false: httpBatchLink({
            url: "/vivd-studio/api/trpc",
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
    })
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
  </StrictMode>
);
