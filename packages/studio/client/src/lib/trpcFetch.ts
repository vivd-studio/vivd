import { reportVivdStudioTransportDegraded } from "@/lib/hostRuntimeSignals";
import { VIVD_STUDIO_TOKEN_HEADER } from "@/lib/studioAuth";
import { resolveTrpcRequestTimeoutMs } from "@/lib/trpcTimeouts";

type StudioTransportDegradedSignal = {
  transport: "trpc-http";
  reason: "network-error" | "timeout";
};

type CreateStudioTrpcFetchOptions = {
  studioToken: string | null;
  fetchImpl?: typeof fetch;
  reportTransportDegraded?: (signal: StudioTransportDegradedSignal) => void;
  resolveTimeoutMs?: (requestTarget: string) => number;
};

function normalizeRequestTarget(url: Parameters<typeof fetch>[0]): string {
  return typeof url === "string" || url instanceof URL ? String(url) : url.url;
}

export function createStudioTrpcFetch({
  studioToken,
  fetchImpl = fetch,
  reportTransportDegraded = reportVivdStudioTransportDegraded,
  resolveTimeoutMs = resolveTrpcRequestTimeoutMs,
}: CreateStudioTrpcFetchOptions) {
  return async function studioTrpcFetch(
    url: Parameters<typeof fetch>[0],
    options?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    const headers = new Headers(options?.headers);
    if (studioToken) {
      headers.set(VIVD_STUDIO_TOKEN_HEADER, studioToken);
    }

    const controller = new AbortController();
    const timeoutTarget = normalizeRequestTarget(url);
    if (timeoutTarget.includes("/undefined")) {
      console.error("[StudioTRPC] Undefined request target", {
        timeoutTarget,
        locationHref: window.location.href,
        locationPathname: window.location.pathname,
        runtimeBasePath:
          (window as Window & { __vivdBasePath?: unknown }).__vivdBasePath ?? null,
        stack: new Error().stack,
      });
    }
    const timeoutMs = resolveTimeoutMs(timeoutTarget);
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(`Timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    const upstreamSignal = options?.signal ?? null;
    const onAbort = () => controller.abort();
    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      upstreamSignal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      return await fetchImpl(url, {
        ...options,
        credentials: "include",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (!upstreamSignal?.aborted) {
        reportTransportDegraded({
          transport: "trpc-http",
          reason: timedOut ? "timeout" : "network-error",
        });
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener("abort", onAbort);
    }
  };
}
