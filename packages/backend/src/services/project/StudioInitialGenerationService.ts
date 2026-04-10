import { studioMachineProvider } from "../studioMachines";
import { resolveStableStudioMachineEnv } from "../studioMachines/stableRuntimeEnv";

const STUDIO_READY_TIMEOUT_MS = 120_000;
const STUDIO_POLL_INTERVAL_MS = 1_000;
const STUDIO_FETCH_TIMEOUT_MS = 10_000;

type StudioInitialGenerationModelSelection = {
  provider: string;
  modelId: string;
  variant?: string;
};

type StudioInitialGenerationStartResult = {
  sessionId: string;
  reused: boolean;
  status: string;
};

type StudioInitialGenerationHandoffResult = {
  status: "starting_studio";
};

type StudioRuntimeConnection = {
  url: string;
  backendUrl?: string | null;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
  accessToken?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveStudioRuntimeUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  if (
    !url.pathname.endsWith("/") &&
    !/\.[a-z0-9]+$/i.test(url.pathname)
  ) {
    url.pathname = `${url.pathname}/`;
  }
  return new URL(path.replace(/^\/+/, ""), ensureTrailingSlash(url.toString())).toString();
}

function getStudioCallBaseUrl(runtime: StudioRuntimeConnection): string {
  const candidates = [
    runtime.backendUrl,
    runtime.runtimeUrl,
    runtime.compatibilityUrl,
    runtime.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  throw new Error("Studio runtime did not provide a usable URL");
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = STUDIO_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function isStudioRuntimeReady(studioBaseUrl: string): Promise<{
  ready: boolean;
  error: Error | null;
}> {
  try {
    const response = await fetchWithTimeout(
      resolveStudioRuntimeUrl(studioBaseUrl, "health"),
      {
        method: "GET",
      },
    );

    if (!response.ok) {
      return {
        ready: false,
        error: new Error(`Studio health check failed with status ${response.status}`),
      };
    }

    const body = (await response.json().catch(() => null)) as
      | { status?: string; initialized?: boolean }
      | null;
    const ready = body?.status === "ok" || body?.initialized === true;

    return {
      ready,
      error: ready
        ? null
        : new Error(`Studio health is ${body?.status ?? "unknown"}`),
    };
  } catch (error) {
    return {
      ready: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function ensureStudioRuntimeReadyForHandoff(options: {
  organizationId: string;
  projectSlug: string;
  version: number;
  requestHost?: string | null;
}): Promise<{
  runtime: StudioRuntimeConnection;
  studioBaseUrl: string;
  accessToken: string;
}> {
  const studioRuntimeEnv = await resolveStableStudioMachineEnv({
    providerKind: studioMachineProvider.kind,
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    requestHost: options.requestHost,
  });

  const runtime = await studioMachineProvider.ensureRunning({
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    version: options.version,
    env: studioRuntimeEnv,
  });

  const accessToken = runtime.accessToken?.trim();
  if (!accessToken) {
    throw new Error("Studio runtime started without an access token");
  }

  const studioBaseUrl = getStudioCallBaseUrl(runtime);
  const startedAt = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startedAt < STUDIO_READY_TIMEOUT_MS) {
    const readiness = await isStudioRuntimeReady(studioBaseUrl);
    if (readiness.ready) {
      return {
        runtime,
        studioBaseUrl,
        accessToken,
      };
    }

    lastError = readiness.error;
    await sleep(STUDIO_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for studio handoff readiness for ${options.projectSlug}/v${options.version}${
      lastError ? `: ${lastError.message}` : ""
    }`,
  );
}

async function tryStartInitialGenerationOnStudio(options: {
  studioBaseUrl: string;
  accessToken: string;
  projectSlug: string;
  version: number;
  model?: StudioInitialGenerationModelSelection;
}): Promise<{
  ok: boolean;
  retryable: boolean;
  result?: StudioInitialGenerationStartResult;
  error?: Error;
}> {
  try {
    const response = await fetchWithTimeout(
      resolveStudioRuntimeUrl(
        options.studioBaseUrl,
        "vivd-studio/api/trpc/agent.startInitialGeneration",
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vivd-studio-token": options.accessToken,
        },
        body: JSON.stringify({
          projectSlug: options.projectSlug,
          version: options.version,
          ...(options.model ? { model: options.model } : {}),
        }),
      },
    );

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim();
      const error = new Error(
        detail
          ? `Studio initial generation start failed (${response.status}): ${detail}`
          : `Studio initial generation start failed (${response.status})`,
      );
      return {
        ok: false,
        retryable:
          response.status === 404 ||
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500,
        error,
      };
    }

    const body = (await response.json().catch(() => null)) as any;
    const result = (body?.result?.data?.json ??
      body?.result?.data ??
      body) as StudioInitialGenerationStartResult | null;

    if (!result?.sessionId || typeof result.sessionId !== "string") {
      return {
        ok: false,
        retryable: false,
        error: new Error(
          "Studio initial generation start did not return a valid session id",
        ),
      };
    }

    return {
      ok: true,
      retryable: false,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function prepareStudioInitialGenerationHandoff(options: {
  organizationId: string;
  projectSlug: string;
  version: number;
  requestHost?: string | null;
}): Promise<StudioInitialGenerationHandoffResult> {
  await ensureStudioRuntimeReadyForHandoff(options);
  return {
    status: "starting_studio",
  };
}

export async function startStudioInitialGeneration(options: {
  organizationId: string;
  projectSlug: string;
  version: number;
  requestHost?: string | null;
  model?: StudioInitialGenerationModelSelection;
}): Promise<StudioInitialGenerationStartResult> {
  const { studioBaseUrl, accessToken } =
    await ensureStudioRuntimeReadyForHandoff(options);
  const startedAt = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startedAt < STUDIO_READY_TIMEOUT_MS) {
    const startAttempt = await tryStartInitialGenerationOnStudio({
      studioBaseUrl,
      accessToken,
      projectSlug: options.projectSlug,
      version: options.version,
      model: options.model,
    });

    if (startAttempt.ok && startAttempt.result) {
      return startAttempt.result;
    }

    lastError = startAttempt.error ?? lastError;
    if (!startAttempt.retryable) {
      throw lastError ?? new Error("Studio initial generation start failed");
    }

    await sleep(STUDIO_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for studio initial generation start for ${options.projectSlug}/v${options.version}${
      lastError ? `: ${lastError.message}` : ""
    }`,
  );
}
