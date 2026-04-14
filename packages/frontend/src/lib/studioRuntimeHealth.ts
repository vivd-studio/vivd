import { resolveStudioRuntimeUrl } from "./studioRuntimeUrl";

type StudioHealthPayload = {
  status?: string;
  initialized?: boolean;
};

export function isStudioHealthReadyPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;

  const health = payload as StudioHealthPayload;
  return health.status === "ok" || health.initialized === true;
}

export async function fetchStudioHealthReady(
  studioProbeBaseUrl: string,
  init: RequestInit = {},
): Promise<boolean> {
  const response = await fetch(
    resolveStudioRuntimeUrl(studioProbeBaseUrl, "health"),
    {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      ...init,
    },
  );

  if (!response.ok) return false;

  const payload =
    typeof response.json === "function" ? await response.json().catch(() => null) : null;
  return isStudioHealthReadyPayload(payload);
}
