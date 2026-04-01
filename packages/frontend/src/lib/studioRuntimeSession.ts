import type { StudioRuntimeSession } from "@/hooks/useStudioHostRuntime";

type RuntimeWithOrigins = {
  url: string | null;
  browserUrl?: string | null;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
};

type RuntimeWithSessionTokens = RuntimeWithOrigins & {
  bootstrapToken: string | null;
  userActionToken?: string | null;
};

export function readStudioRuntimeOrigins(runtime: RuntimeWithOrigins): {
  browserUrl: string | null;
  runtimeUrl: string | null;
  compatibilityUrl: string | null;
} {
  return {
    browserUrl: runtime.browserUrl ?? null,
    runtimeUrl: runtime.runtimeUrl ?? runtime.url ?? null,
    compatibilityUrl: runtime.compatibilityUrl ?? null,
  };
}

export function createStudioRuntimeSession(
  runtime: RuntimeWithSessionTokens,
): StudioRuntimeSession {
  const { browserUrl, runtimeUrl, compatibilityUrl } = readStudioRuntimeOrigins(runtime);
  const url = browserUrl ?? runtime.url ?? runtimeUrl ?? compatibilityUrl;

  if (!url) {
    throw new Error("Studio runtime session requires at least one URL");
  }

  return {
    url,
    browserUrl,
    runtimeUrl,
    compatibilityUrl,
    bootstrapToken: runtime.bootstrapToken ?? null,
    userActionToken: runtime.userActionToken ?? null,
  };
}
