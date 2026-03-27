#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { createStudioBootstrapToken } from "@vivd/shared/studio";

const DEFAULT_IMAGE = "vivd-studio:release-smoke";
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MODEL_TIERS = ["standard", "advanced"];
const PROJECT_SLUG = "ci-studio-smoke";
const PROJECT_VERSION = 1;
const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
const STUDIO_AUTH_COOKIE = "vivd_studio_token";

function log(message) {
  console.log(`[studio-image-smoke] ${message}`);
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getOptionalBooleanEnv(name, defaultValue = false) {
  const value = getOptionalEnv(name);
  if (!value) return defaultValue;

  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value for ${name}: ${value}`);
}

function parseModelSelection(rawValue, tier) {
  const slashIndex = rawValue.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= rawValue.length - 1) {
    throw new Error(
      `Invalid model value for ${tier}: expected "provider/modelId", got "${rawValue}"`,
    );
  }

  return {
    tier,
    envKey: `OPENCODE_MODEL_${tier.toUpperCase()}`,
    rawValue,
    provider: rawValue.slice(0, slashIndex),
    modelId: rawValue.slice(slashIndex + 1),
  };
}

function getModelTiers() {
  const raw = (process.env.VIVD_STUDIO_SMOKE_MODEL_TIERS || "").trim();
  if (!raw) {
    return DEFAULT_MODEL_TIERS;
  }

  const tiers = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (tiers.length === 0) {
    return DEFAULT_MODEL_TIERS;
  }

  const supported = new Set(["standard", "advanced", "pro"]);
  for (const tier of tiers) {
    if (!supported.has(tier)) {
      throw new Error(
        `Unsupported model tier "${tier}" in VIVD_STUDIO_SMOKE_MODEL_TIERS`,
      );
    }
  }

  return tiers;
}

function shouldRequireModelRoundTrips() {
  return getOptionalBooleanEnv("VIVD_STUDIO_SMOKE_REQUIRE_MODELS", false);
}

function hasProviderCredentials(selection) {
  switch (selection.provider) {
    case "openrouter":
      return Boolean(getOptionalEnv("OPENROUTER_API_KEY"));
    case "google":
      return Boolean(
        getOptionalEnv("GOOGLE_API_KEY") ||
          getOptionalEnv("GOOGLE_APPLICATION_CREDENTIALS") ||
          getOptionalEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
      );
    default:
      return true;
  }
}

function getModelSelections() {
  const requireModelRoundTrips = shouldRequireModelRoundTrips();
  const missingEnvKeys = [];
  const selections = [];

  for (const tier of getModelTiers()) {
    const envKey = `OPENCODE_MODEL_${tier.toUpperCase()}`;
    const rawValue = getOptionalEnv(envKey);
    if (!rawValue) {
      missingEnvKeys.push(envKey);
      continue;
    }

    selections.push(parseModelSelection(rawValue, tier));
  }

  if (missingEnvKeys.length > 0) {
    if (missingEnvKeys.length === getModelTiers().length && !requireModelRoundTrips) {
      log("Skipping model round-trips: no model tiers configured for this smoke run.");
      return [];
    }

    throw new Error(
      `Missing configured model tier env(s): ${missingEnvKeys.join(", ")}`,
    );
  }

  const missingProviderCredentials = selections.filter(
    (selection) => !hasProviderCredentials(selection),
  );

  if (missingProviderCredentials.length > 0) {
    const message = `Missing provider credentials for: ${missingProviderCredentials
      .map((selection) => `${selection.tier}=${selection.provider}`)
      .join(", ")}`;
    if (requireModelRoundTrips) {
      throw new Error(message);
    }

    log(`Skipping model round-trips: ${message}`);
    return [];
  }

  return selections;
}

function getSmokeTimeoutMs() {
  const raw = (process.env.VIVD_STUDIO_SMOKE_TIMEOUT_MS || "").trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 30_000) {
    throw new Error(
      "VIVD_STUDIO_SMOKE_TIMEOUT_MS must be an integer >= 30000",
    );
  }

  return parsed;
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address && "port" in address) {
          resolve(address.port);
          return;
        }
        reject(new Error("Could not determine free port"));
      });
    });
  });
}

function runDocker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `docker ${args.join(" ")} failed (${result.status}): ${stderr || stdout || "unknown error"}`,
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function getContainerLogs(containerId) {
  const result = runDocker(["logs", containerId], { allowFailure: true });
  return `${result.stdout}${result.stderr}`.trim();
}

function assertContainerRunning(containerId, phase) {
  const inspect = runDocker(
    ["inspect", "-f", "{{.State.Running}}", containerId],
    { allowFailure: true },
  );

  if (inspect.status === 0 && inspect.stdout.trim() === "true") {
    return;
  }

  const logs = getContainerLogs(containerId);
  throw new Error(
    `Studio container stopped during ${phase}.${logs ? ` Logs:\n${logs}` : ""}`,
  );
}

async function waitForHealth(baseUrl, containerId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    assertContainerRunning(containerId, "startup");

    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ok" && body?.initialized === true) {
          return body;
        }
      }
    } catch {
      // Retry.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for Studio health at ${baseUrl}/health`);
}

function createTrpcClient(baseUrl, accessToken) {
  return createTRPCProxyClient({
    links: [
      httpBatchLink({
        url: new URL("/trpc", baseUrl).toString(),
        fetch(url, init) {
          const headers = new Headers(init?.headers);
          headers.set(STUDIO_AUTH_HEADER, accessToken);
          return fetch(url, { ...init, headers });
        },
      }),
    ],
  });
}

async function verifyAuthSurface(baseUrl, accessToken) {
  const unauthorized = await fetch(`${baseUrl}/vivd-studio`, {
    redirect: "manual",
  });
  assert.equal(
    unauthorized.status,
    401,
    "Expected Studio UI to reject requests without auth",
  );

  const authorized = await fetch(`${baseUrl}/vivd-studio`, {
    headers: {
      [STUDIO_AUTH_HEADER]: accessToken,
    },
  });
  assert.equal(
    authorized.status,
    200,
    "Expected Studio UI to accept requests with auth",
  );

  const html = await authorized.text();
  assert.match(html, /<html/i, "Expected Studio UI HTML payload");
}

function readSetCookieHeader(response) {
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      return cookies.join(", ");
    }
  }

  return response.headers.get("set-cookie") || "";
}

function extractCookieHeader(setCookieHeader) {
  const cookieMatch = setCookieHeader.match(
    new RegExp(`${STUDIO_AUTH_COOKIE}=([^;]+)`),
  );
  assert.ok(cookieMatch, "Expected bootstrap response to set Studio auth cookie");
  return `${STUDIO_AUTH_COOKIE}=${cookieMatch[1]}`;
}

async function verifyBootstrapFlow(baseUrl, accessToken, studioId) {
  const bootstrapToken = createStudioBootstrapToken({
    accessToken,
    studioId,
  });

  const response = await fetch(`${baseUrl}/vivd-studio/api/bootstrap`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bootstrapToken,
      next: `${baseUrl}/vivd-studio?embedded=1`,
    }),
  });

  assert.equal(
    response.status,
    303,
    "Expected bootstrap endpoint to redirect after successful auth handoff",
  );
  assert.equal(
    response.headers.get("location"),
    "/vivd-studio?embedded=1",
    "Expected bootstrap redirect to sanitize the Studio target",
  );

  const setCookieHeader = readSetCookieHeader(response);
  assert.match(
    setCookieHeader,
    new RegExp(`${STUDIO_AUTH_COOKIE}=`),
    "Expected bootstrap response to include the Studio auth cookie",
  );

  const followUp = await fetch(`${baseUrl}/vivd-studio?embedded=1`, {
    headers: {
      Cookie: extractCookieHeader(setCookieHeader),
    },
  });

  assert.equal(
    followUp.status,
    200,
    "Expected bootstrap-issued cookie to authorize the Studio shell",
  );
}

async function waitForSessionIdle(client, sessionId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const statuses = await client.agent.getSessionsStatus.query({
      projectSlug: PROJECT_SLUG,
      version: PROJECT_VERSION,
    });

    const status = statuses?.[sessionId]?.type;
    if (status === "idle" || status === "done") {
      return;
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for session ${sessionId} to become idle`);
}

function extractAssistantText(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

async function waitForAssistantReply(client, sessionId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const messages = await client.agent.getSessionContent.query({
      sessionId,
      projectSlug: PROJECT_SLUG,
      version: PROJECT_VERSION,
    });

    const assistantMessage = [...messages]
      .reverse()
      .find((message) => message?.info?.role === "assistant");

    if (assistantMessage) {
      const text = extractAssistantText(assistantMessage);
      if (text) {
        return { text, messages };
      }
    }

    await sleep(2_000);
  }

  throw new Error(
    `Timed out waiting for assistant reply in session ${sessionId}`,
  );
}

function assertAvailableModel(availableModels, selection) {
  const available = availableModels.find((entry) => entry?.tier === selection.tier);
  assert.ok(
    available,
    `Configured ${selection.tier} tier missing from Studio model list`,
  );
  assert.equal(
    available.provider,
    selection.provider,
    `${selection.tier} provider mismatch`,
  );
  assert.equal(
    available.modelId,
    selection.modelId,
    `${selection.tier} model mismatch`,
  );
}

async function runPromptRoundTrip(client, selection, timeoutMs) {
  const marker = `studio-smoke-${selection.tier}-${randomUUID().slice(0, 8)}`;
  log(`Running ${selection.tier} prompt round-trip with ${selection.rawValue}`);

  const run = await client.agent.runTask.mutate({
    projectSlug: PROJECT_SLUG,
    version: PROJECT_VERSION,
    task: `Reply with exactly "${marker}" and nothing else. Do not edit any files.`,
    model: {
      provider: selection.provider,
      modelId: selection.modelId,
    },
  });

  assert.equal(run?.success, true, `${selection.tier} runTask did not succeed`);
  assert.ok(
    typeof run?.sessionId === "string" && run.sessionId.length > 0,
    `${selection.tier} runTask did not return a sessionId`,
  );

  await waitForSessionIdle(client, run.sessionId, timeoutMs);
  const assistant = await waitForAssistantReply(client, run.sessionId, timeoutMs);
  assert.match(
    assistant.text,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${selection.tier} assistant reply did not include the expected marker`,
  );

  log(`${selection.tier} round-trip succeeded`);
}

function createWorkspaceDir() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "vivd-studio-smoke-"));
  writeFileSync(
    path.join(directory, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      '    <meta charset="utf-8" />',
      "    <title>Vivd Studio Smoke Test</title>",
      "  </head>",
      "  <body>",
      "    <main>",
      "      <h1>Vivd Studio Smoke Test</h1>",
      "      <p>This workspace is used to verify the release image can boot.</p>",
      "    </main>",
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  return directory;
}

function buildDockerEnvArgs(accessToken, studioId) {
  const env = {
    PORT: "3100",
    STUDIO_ACCESS_TOKEN: accessToken,
    STUDIO_ID: studioId,
    VIVD_WORKSPACE_DIR: "/workspace/project",
    OPENCODE_IDLE_TIMEOUT_MS: "0",
    OPENCODE_SERVER_READY_TIMEOUT_MS: "120000",
  };

  const passthroughKeys = [
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_CLOUD_PROJECT",
    "VERTEX_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH",
    "OPENCODE_MODEL_STANDARD",
    "OPENCODE_MODEL_ADVANCED",
    "OPENCODE_MODEL_PRO",
  ];

  for (const key of passthroughKeys) {
    const value = getOptionalEnv(key);
    if (value) {
      env[key] = value;
    }
  }

  const args = [];
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

function tryRemoveWorkspaceDir(workspaceDir) {
  try {
    rmSync(workspaceDir, { recursive: true, force: true });
    return null;
  } catch (error) {
    return error;
  }
}

function attemptWorkspacePermissionRepair(image, workspaceDir) {
  return runDocker(
    [
      "run",
      "--rm",
      "--volume",
      `${workspaceDir}:/workspace/project`,
      "--entrypoint",
      "/bin/sh",
      image,
      "-lc",
      "chmod -R a+rwX /workspace/project || true",
    ],
    { allowFailure: true },
  );
}

function cleanupWorkspaceDir(image, workspaceDir) {
  const initialError = tryRemoveWorkspaceDir(workspaceDir);
  if (!initialError) {
    return;
  }

  const initialCode =
    typeof initialError === "object" && initialError && "code" in initialError
      ? String(initialError.code)
      : "unknown";
  log(
    `Workspace cleanup hit ${initialCode}; attempting permission repair before retry.`,
  );

  attemptWorkspacePermissionRepair(image, workspaceDir);

  const retryError = tryRemoveWorkspaceDir(workspaceDir);
  if (!retryError) {
    return;
  }

  const retryMessage =
    retryError instanceof Error ? retryError.message : String(retryError);
  console.warn(
    `[studio-image-smoke] Warning: failed to remove temp workspace ${workspaceDir}: ${retryMessage}`,
  );
}

async function main() {
  const image = getOptionalEnv("STUDIO_IMAGE") || DEFAULT_IMAGE;
  const timeoutMs = getSmokeTimeoutMs();
  const modelSelections = getModelSelections();
  const accessToken = getOptionalEnv("STUDIO_ACCESS_TOKEN") || randomUUID();
  const studioId = getOptionalEnv("STUDIO_ID") || "studio-image-smoke";
  const workspaceDir = createWorkspaceDir();
  const port = await getFreePort();
  const containerName = `vivd-studio-smoke-${randomUUID().slice(0, 12)}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  let succeeded = false;

  log(`Using image ${image}`);
  log(
    modelSelections.length > 0
      ? `Configured model tiers: ${modelSelections
          .map((selection) => `${selection.tier}=${selection.rawValue}`)
          .join(", ")}`
      : "Configured model tiers: none (model round-trips skipped for this smoke run)",
  );

  let containerId = null;
  try {
    const runArgs = [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--publish",
      `127.0.0.1:${port}:3100`,
      "--volume",
      `${workspaceDir}:/workspace/project`,
      ...buildDockerEnvArgs(accessToken, studioId),
      image,
    ];

    containerId = runDocker(runArgs).stdout.trim();
    if (!containerId) {
      throw new Error("docker run did not return a container id");
    }

    await waitForHealth(baseUrl, containerId, timeoutMs);
    await verifyAuthSurface(baseUrl, accessToken);
    await verifyBootstrapFlow(baseUrl, accessToken, studioId);

    const client = createTrpcClient(baseUrl, accessToken);
    if (modelSelections.length > 0) {
      const availableModels = await client.agent.getAvailableModels.query();
      for (const selection of modelSelections) {
        assertAvailableModel(availableModels, selection);
      }

      for (const selection of modelSelections) {
        await runPromptRoundTrip(client, selection, timeoutMs);
      }
    }

    succeeded = true;
    log("Studio image smoke test completed successfully");
  } finally {
    if (containerId) {
      const logs = !succeeded ? getContainerLogs(containerId) : "";
      if (logs) {
        log("Container logs:");
        process.stdout.write(`${logs}\n`);
      }
      runDocker(["rm", "-f", containerId], { allowFailure: true });
    }

    cleanupWorkspaceDir(image, workspaceDir);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[studio-image-smoke] ${message}`);
  process.exit(1);
});
