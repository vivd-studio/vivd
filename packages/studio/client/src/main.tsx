import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import {
  getVivdStudioToken,
  VIVD_STUDIO_TOKEN_HEADER,
  withVivdStudioTokenQuery,
} from "@/lib/studioAuth";
import { resolveTrpcRequestTimeoutMs } from "@/lib/trpcTimeouts";
import { ThemeProvider } from "@/components/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "@/App";
import "./index.css";

function Root() {
  const studioToken = getVivdStudioToken();

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
            url: withVivdStudioTokenQuery("/vivd-studio/api/trpc", studioToken),
          }),
          false: httpBatchLink({
            url: "/vivd-studio/api/trpc",
            fetch(url, options) {
              const headers = new Headers(options?.headers);
              if (studioToken) {
                headers.set(VIVD_STUDIO_TOKEN_HEADER, studioToken);
              }

              const controller = new AbortController();
              const timeoutMs = resolveTrpcRequestTimeoutMs(url);
              const timeoutId = window.setTimeout(() => {
                controller.abort(`Timed out after ${timeoutMs}ms`);
              }, timeoutMs);

              const upstreamSignal = options?.signal ?? null;
              const onAbort = () => controller.abort();
              if (upstreamSignal) {
                if (upstreamSignal.aborted) controller.abort();
                upstreamSignal.addEventListener("abort", onAbort, { once: true });
              }

              return fetch(url, {
                ...options,
                credentials: "include",
                headers,
                signal: controller.signal,
              }).finally(() => {
                window.clearTimeout(timeoutId);
                upstreamSignal?.removeEventListener("abort", onAbort);
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
