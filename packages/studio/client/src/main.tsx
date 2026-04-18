import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import {
  getVivdStudioToken,
  resolveStudioRuntimePath,
  withVivdStudioTokenQuery,
} from "@/lib/studioAuth";
import { createStudioTrpcFetch } from "@/lib/trpcFetch";
import { ThemeProvider } from "@/components/theme";
import { TooltipProvider } from "@vivd/ui";

import { App } from "@/App";
import "./index.css";

function Root() {
  const studioToken = getVivdStudioToken();
  const studioTrpcFetch = createStudioTrpcFetch({ studioToken });

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 2,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({
            url: withVivdStudioTokenQuery(
              resolveStudioRuntimePath("/vivd-studio/api/trpc"),
              studioToken,
            ),
          }),
          false: httpBatchLink({
            url: resolveStudioRuntimePath("/vivd-studio/api/trpc"),
            fetch: studioTrpcFetch,
          }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
