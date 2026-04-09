#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_PORT_TAKEOVER_TIMEOUT_MS = 30_000;
const PORT_TAKEOVER_POLL_INTERVAL_MS = 500;
const DEFAULT_STUDIO_IMAGE = "vivd-studio:release-smoke";
const DEFAULT_HOST_SMOKE_PORT = 18_080;
const DEFAULT_CONTROL_PLANE_HOSTNAME = "app.localhost";
const DEFAULT_TENANT_HOSTNAME = "default.localhost";
const DEFAULT_DOCS_HOSTNAME = "docs.localhost";
const DEFAULT_AUTH_WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_GENERATION_SETTLE_TIMEOUT_MS = 45_000;
const DEFAULT_GENERATION_BUSY_GRACE_TIMEOUT_MS = 30_000;
const DEFAULT_GENERATION_STOP_OPPORTUNITY_TIMEOUT_MS = 15_000;
const INITIAL_GENERATION_ACTION_POLL_MS = 2_000;
const DEFAULT_INITIAL_GENERATION_MIN_RECORDED_ACTIONS = 2;
const INITIAL_GENERATION_SESSION_HISTORY_PROBE_INTERVAL_MS = 10_000;
const DEFAULT_STUDIO_READY_TIMEOUT_MS = 90_000;
const STUDIO_READY_PROGRESS_LOG_INTERVAL_MS = 15_000;
const MAX_AUTH_SETTLE_ATTEMPTS = 3;
const DEFAULT_HOST_SMOKE_FALLBACK_MODEL = "openrouter/google/gemini-2.5-flash-lite";
const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
const FAILING_CONSOLE_PATTERNS = [
  /invalid bootstrap target/i,
  /localhost:undefined/i,
  /api\/bootstrap.*400 \(bad request\)/i,
];

const NON_FATAL_CONSOLE_PATTERNS = [
  /blocked by cors policy/i,
  /\/health'.*has been blocked by cors policy/i,
  /failed to execute 'postmessage'.*does not match the recipient window's origin/i,
];

function log(message) {
  console.log(`[studio-docker-host-smoke] ${message}`);
}

function isStudioProjectRouteUrl(value) {
  try {
    const url = new URL(value);
    return (
      /^\/vivd-studio\/projects\/[^/]+$/u.test(url.pathname) &&
      url.searchParams.get("view") === "studio" &&
      url.searchParams.get("initialGeneration") === "1"
    );
  } catch {
    return false;
  }
}

function isTrpcProcedureUrl(value, procedureName) {
  try {
    const url = new URL(value);
    return url.pathname.includes(`/vivd-studio/api/trpc/${procedureName}`);
  } catch {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${stderr || stdout || "unknown error"}`,
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function parseDotenvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex <= 0) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  if (!key) return null;

  let value = trimmed.slice(eqIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadLocalEnv(baseEnv) {
  const nextEnv = { ...baseEnv };
  const rootDir = process.cwd();
  const files = [
    ".env",
    ".env.local",
    "packages/backend/.env",
    "packages/backend/.env.local",
  ];

  for (const relativeFile of files) {
    const absoluteFile = path.join(rootDir, relativeFile);
    if (!existsSync(absoluteFile)) continue;

    const lines = readFileSync(absoluteFile, "utf8").split(/\r?\n/u);
    for (const line of lines) {
      const parsed = parseDotenvLine(line);
      if (!parsed) continue;
      if (nextEnv[parsed.key] == null || nextEnv[parsed.key] === "") {
        nextEnv[parsed.key] = parsed.value;
      }
    }
  }

  return nextEnv;
}

function getOptionalEnv(name, env = process.env) {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readBooleanEnv(name, fallback, env = process.env) {
  const raw = getOptionalEnv(name, env);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readPositiveIntEnv(name, fallback, env = process.env) {
  const raw = getOptionalEnv(name, env);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeIntEnv(name, fallback, env = process.env) {
  const raw = getOptionalEnv(name, env);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function buildHttpOrigin(hostname, port) {
  return `http://${hostname}${port === 80 ? "" : `:${port}`}`;
}

function isPwDebugEnabled(env = process.env) {
  const raw = getOptionalEnv("PWDEBUG", env);
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  return !["0", "false", "off", "no"].includes(normalized);
}

function formatCheckpointDetails(details = {}) {
  const pairs = Object.entries(details).filter(([, value]) => value !== undefined && value !== null);
  if (pairs.length === 0) return "";
  return ` (${pairs.map(([key, value]) => `${key}=${value}`).join(", ")})`;
}

function markCheckpoint(checkpoints, name, startedAt, details = {}) {
  const entry = {
    name,
    elapsedMs: Date.now() - startedAt,
    ...details,
  };
  checkpoints.push(entry);
  log(`Checkpoint: ${name}${formatCheckpointDetails(details)} [${entry.elapsedMs}ms]`);
  return entry;
}

async function pauseForInspection(reason) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log(`Interactive inspection requested but no TTY is available (${reason}).`);
    return;
  }

  log(`${reason}. Press Enter to continue teardown.`);

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

function canTakeOverPort(port, env) {
  const genericRaw = getOptionalEnv("VIVD_STUDIO_HOST_SMOKE_TAKEOVER_HOST_PORT", env);
  if (genericRaw) {
    return ["1", "true", "yes", "on"].includes(genericRaw.toLowerCase());
  }

  if (port !== 80) return false;

  const raw = getOptionalEnv("VIVD_STUDIO_HOST_SMOKE_TAKEOVER_PORT_80", env);
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function describeListeningPort(port) {
  const result = runCommand(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
    { allowFailure: true },
  );
  return `${result.stdout}${result.stderr}`.trim();
}

function isPortListening(port) {
  return describeListeningPort(port).length > 0;
}

async function waitForPortToBeFree(port, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isPortListening(port)) {
      return;
    }
    await sleep(PORT_TAKEOVER_POLL_INTERVAL_MS);
  }

  const portDescription = describeListeningPort(port);
  const suffix = portDescription
    ? ` Remaining listener(s):\n${portDescription}`
    : "";
  throw new Error(`Port ${port} did not become available within ${timeoutMs}ms.${suffix}`);
}

function listComposeCaddiesForHostPort(port) {
  const result = runCommand(
    "docker",
    [
      "ps",
      "--format",
      "{{.ID}}\t{{.Names}}\t{{.Ports}}\t{{.Label \"com.docker.compose.service\"}}",
    ],
    { allowFailure: true },
  );

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, ports = "", composeService = ""] = line.split("\t");
      return { id, name, ports, composeService };
    })
    .filter(
      (entry) =>
        entry.composeService === "caddy" &&
        new RegExp(
          String.raw`(^|,|\s)(0\.0\.0\.0|127\.0\.0\.1|\[::\]|::):${port}->80/tcp`,
          "i",
        ).test(entry.ports),
    );
}

async function acquireHostPort(port, env) {
  const takeoverTimeoutMs = readPositiveIntEnv(
    "VIVD_STUDIO_HOST_SMOKE_PORT_TAKEOVER_TIMEOUT_MS",
    DEFAULT_PORT_TAKEOVER_TIMEOUT_MS,
    env,
  );

  if (!isPortListening(port)) {
    return [];
  }

  const portDescription = describeListeningPort(port);
  if (!canTakeOverPort(port, env)) {
    throw new Error(
      `Port ${port} is already in use.${
        port === 80
          ? " Re-run with VIVD_STUDIO_HOST_SMOKE_TAKEOVER_PORT_80=1 (or VIVD_STUDIO_HOST_SMOKE_TAKEOVER_HOST_PORT=1) to temporarily pause the local Caddy dev proxy during the smoke."
          : ""
      }${
        portDescription ? ` Current listener(s):\n${portDescription}` : ""
      }`,
    );
  }

  const caddies = listComposeCaddiesForHostPort(port);
  if (caddies.length === 0) {
    throw new Error(
      `Port ${port} is already in use, but no compose-managed Caddy container could be identified for temporary takeover.`,
    );
  }

  log(
    `Temporarily stopping Caddy container(s) using host port ${port}: ${caddies
      .map((entry) => entry.name)
      .join(", ")}`,
  );
  for (const entry of caddies) {
    runCommand("docker", ["stop", entry.id]);
  }

  try {
    await waitForPortToBeFree(port, takeoverTimeoutMs);
  } catch (error) {
    throw new Error(
      `Port ${port} is still busy after stopping the local Caddy container(s).`,
      { cause: error },
    );
  }

  return caddies;
}

function restartContainers(containers) {
  for (const entry of containers) {
    try {
      runCommand("docker", ["start", entry.id]);
      log(`Restarted ${entry.name}`);
    } catch (error) {
      console.error(
        `[studio-docker-host-smoke] Failed to restart ${entry.name}: ${String(error)}`,
      );
    }
  }
}

function runDockerCompose(projectName, composeArgs, options = {}) {
  return runCommand(
    "docker",
    [
      "compose",
      "-p",
      projectName,
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.smoke.yml",
      ...composeArgs,
    ],
    {
      cwd: options.cwd,
      env: options.env,
      allowFailure: options.allowFailure,
    },
  );
}

function listManagedStudioContainersOnNetwork(networkName) {
  const result = runCommand(
    "docker",
    [
      "ps",
      "-a",
      "--filter",
      `network=${networkName}`,
      "--filter",
      "label=vivd_provider=docker",
      "--format",
      "{{.ID}}\t{{.Names}}",
    ],
    { allowFailure: true },
  );

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name = ""] = line.split("\t");
      return { id, name };
    });
}

function removeContainers(containers) {
  for (const entry of containers) {
    try {
      runCommand("docker", ["rm", "-f", entry.id]);
      log(`Removed managed Studio container ${entry.name || entry.id}`);
    } catch (error) {
      console.error(
        `[studio-docker-host-smoke] Failed to remove managed Studio container ${entry.name || entry.id}: ${String(error)}`,
      );
    }
  }
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry.
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function expectVisible(locator, timeoutMs, description) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  return description;
}

async function waitForVisibleState(candidates, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const candidate of candidates) {
      if (await candidate.locator.isVisible().catch(() => false)) {
        return candidate.name;
      }
    }
    await sleep(200);
  }

  return null;
}

async function readIframeNavigationState(iframeLocator) {
  const iframe = iframeLocator.first();
  const iframeAttrSrc = await iframe.getAttribute("src").catch(() => null);
  const iframeHandle = await iframe.elementHandle().catch(() => null);
  const iframeFrame = iframeHandle
    ? await iframeHandle.contentFrame().catch(() => null)
    : null;

  return {
    iframeAttrSrc,
    iframeFrameUrl: iframeFrame?.url() ?? null,
    iframeFrame,
  };
}

async function detectAuthMode(page, timeoutMs) {
  return waitForVisibleState(
    [
      {
        name: "signup",
        locator: page.getByRole("button", { name: "Create Admin Account" }),
      },
      {
        name: "login",
        locator: page.getByRole("button", { name: "Login" }),
      },
    ],
    timeoutMs,
  );
}

async function completeAuthOnCurrentPage({
  page,
  origin,
  credentials,
  timeoutMs,
}) {
  const signupButton = page.getByRole("button", { name: "Create Admin Account" });
  const loginButton = page.getByRole("button", { name: "Login" });
  const authMode = await detectAuthMode(
    page,
    Math.min(timeoutMs, DEFAULT_AUTH_WAIT_TIMEOUT_MS),
  );

  if (!authMode) {
    return "no-auth-screen";
  }

  if (authMode === "signup") {
    await page.getByLabel("Name").fill(credentials.name);
  }

  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  const submitButton = authMode === "signup" ? signupButton : loginButton;
  const authResponsePromise = page.waitForResponse(
    (response) => {
      if (response.request().method() !== "POST") return false;
      try {
        const url = new URL(response.url());
        return url.origin === origin && url.pathname.startsWith("/vivd-studio/api/auth/");
      } catch {
        return false;
      }
    },
    { timeout: Math.min(timeoutMs, DEFAULT_AUTH_WAIT_TIMEOUT_MS) },
  );

  await submitButton.click();
  const authResponse = await authResponsePromise;
  if (!authResponse.ok()) {
    const responseBody = await authResponse.text().catch(() => "");
    throw new Error(
      `Auth request failed (${authResponse.status()}) on ${authMode}: ${responseBody || authResponse.statusText() || "unknown error"}`,
    );
  }

  await page.waitForURL(
    (url) => url.origin === origin && url.pathname.startsWith("/vivd-studio"),
    { timeout: Math.min(timeoutMs, DEFAULT_AUTH_WAIT_TIMEOUT_MS) },
  ).catch(() => undefined);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await sleep(500);

  return authMode;
}

async function authenticateUntilReady({
  page,
  origin,
  targetPath,
  credentials,
  timeoutMs,
}) {
  const targetUrl = `${origin}${targetPath}`;
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  for (let attempt = 1; attempt <= MAX_AUTH_SETTLE_ATTEMPTS; attempt += 1) {
    const authMode = await detectAuthMode(
      page,
      Math.min(timeoutMs, DEFAULT_AUTH_WAIT_TIMEOUT_MS),
    );

    if (!authMode) {
      return;
    }

    log(
      `Auth settle attempt ${attempt}/${MAX_AUTH_SETTLE_ATTEMPTS} on ${targetPath}: ${authMode}`,
    );
    await completeAuthOnCurrentPage({
      page,
      origin,
      credentials,
      timeoutMs,
    });
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  }

  throw new Error(
    `Authentication did not settle after ${MAX_AUTH_SETTLE_ATTEMPTS} attempts for ${targetUrl}; current URL is ${page.url()}`,
  );
}

async function authenticateOnHost({
  page,
  origin,
  credentials,
  timeoutMs,
}) {
  await authenticateUntilReady({
    page,
    origin,
    targetPath: "/vivd-studio",
    credentials,
    timeoutMs,
  });
}

async function ensureScratchWizardVisible({
  page,
  controlPlaneOrigin,
  credentials,
  timeoutMs,
}) {
  const scratchHeading = page.getByRole("heading", { name: /What should we build/i });
  const visibleState = await waitForVisibleState(
    [
      { name: "scratch", locator: scratchHeading },
      { name: "signup", locator: page.getByRole("button", { name: "Create Admin Account" }) },
      { name: "login", locator: page.getByRole("button", { name: "Login" }) },
    ],
    timeoutMs,
  );

  if (visibleState === "scratch") {
    return;
  }

  if (visibleState === "signup" || visibleState === "login") {
    log(
      `Scratch route showed ${visibleState} screen; completing auth and retrying scratch navigation`,
    );
    await authenticateUntilReady({
      page,
      origin: controlPlaneOrigin,
      targetPath: "/vivd-studio/projects/new/scratch",
      credentials,
      timeoutMs,
    });
    await expectVisible(scratchHeading, timeoutMs, "scratch wizard");
    return;
  }

  throw new Error(
    `Scratch wizard did not become visible and no auth screen was detected at ${page.url()}`,
  );
}

async function readTrpcResponseSummary(response) {
  const text = await response.text().catch(() => "");
  let parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  const payload = Array.isArray(parsed) ? parsed[0] : parsed;
  const errorMessage =
    payload?.error?.json?.message ??
    payload?.error?.message ??
    null;

  return {
    url: response.url(),
    status: response.status(),
    ok: response.ok() && !errorMessage,
    errorMessage,
    result: payload?.result?.data?.json ?? payload?.result?.data ?? null,
    rawText: text || null,
  };
}

async function readScratchSubmitState(page) {
  return await page
    .evaluate(() => {
      const titleInput = document.querySelector('input[placeholder="Acme Studio"]');
      const descriptionInput = document.querySelector(
        'textarea[placeholder="Describe the website you want to create."]',
      );
      const submitButton = document.querySelector('form button[type="submit"]');
      const bodyText = document.body?.innerText ?? "";
      const statusLabel =
        [
          "Creating project…",
          "Uploading assets…",
          "Starting generation…",
          "Generating…",
        ].find((candidate) => bodyText.includes(candidate)) ?? null;
      const projectText =
        bodyText
          .split(/\n/u)
          .map((line) => line.trim())
          .find((line) => line.startsWith("Project:")) ?? null;
      const authScreen = bodyText.includes("Create Admin Account")
        ? "signup"
        : bodyText.includes("Login")
          ? "login"
          : null;

      return {
        authScreen,
        statusLabel,
        projectText,
        titleDisabled:
          titleInput instanceof HTMLInputElement ? titleInput.disabled : null,
        descriptionDisabled:
          descriptionInput instanceof HTMLTextAreaElement
            ? descriptionInput.disabled
            : null,
        submitDisabled:
          submitButton instanceof HTMLButtonElement
            ? submitButton.disabled
            : null,
      };
    })
    .catch(() => ({
      authScreen: null,
      statusLabel: null,
      projectText: null,
      titleDisabled: null,
      descriptionDisabled: null,
      submitDisabled: null,
    }));
}

async function createScratchProject({
  page,
  controlPlaneOrigin,
  credentials,
  timeoutMs,
}) {
  assert.equal(
    typeof timeoutMs,
    "number",
    "createScratchProject() requires a numeric timeoutMs",
  );
  assert.equal(
    typeof credentials?.email,
    "string",
    "createScratchProject() requires signup credentials",
  );
  const title = `Smoke ${randomUUID().slice(0, 8)}`;
  const description =
    "Create a polished one-page marketing site. Move fast and keep the first iteration concise.";

  await page.goto(`${controlPlaneOrigin}/vivd-studio/projects/new/scratch`, {
    waitUntil: "domcontentloaded",
  });
  await ensureScratchWizardVisible({
    page,
    controlPlaneOrigin,
    credentials,
    timeoutMs,
  });

  await page.getByPlaceholder("Acme Studio").fill(title);
  await page
    .getByPlaceholder("Describe the website you want to create.")
    .fill(description);

  let createDraftResponseSummary = null;
  let startGenerationResponseSummary = null;
  const createDraftResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isTrpcProcedureUrl(response.url(), "project.createScratchDraft"),
      { timeout: Math.min(timeoutMs, 60_000) },
    )
    .then(readTrpcResponseSummary)
    .then((summary) => {
      createDraftResponseSummary = summary;
      return summary;
    })
    .catch((error) => {
      createDraftResponseSummary = {
        waitError: error instanceof Error ? error.message : String(error),
      };
      return createDraftResponseSummary;
    });
  const startGenerationResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isTrpcProcedureUrl(response.url(), "project.startScratchGeneration"),
      { timeout: timeoutMs },
    )
    .then(readTrpcResponseSummary)
    .then((summary) => {
      startGenerationResponseSummary = summary;
      return summary;
    })
    .catch((error) => {
      startGenerationResponseSummary = {
        waitError: error instanceof Error ? error.message : String(error),
      };
      return startGenerationResponseSummary;
    });

  const submitStartedAt = Date.now();
  await page.locator("form button[type='submit']").click();

  const createDraftResponse = await createDraftResponsePromise;
  if (createDraftResponse?.waitError) {
    throw new Error(
      `Scratch submit never completed createScratchDraft within 60000ms: ${createDraftResponse.waitError}`,
    );
  }
  if (!createDraftResponse?.ok) {
    throw new Error(
      `createScratchDraft failed: ${JSON.stringify(createDraftResponse)}`,
    );
  }

  let lastProgressLogAt = 0;
  while (Date.now() - submitStartedAt < timeoutMs) {
    if (isStudioProjectRouteUrl(page.url())) {
      const redirectedAt = Date.now();
      const projectUrl = new URL(page.url());
      const projectSlug = projectUrl.pathname.split("/").filter(Boolean).pop();
      assert(projectSlug, "Expected redirected project slug in URL");

      return {
        projectSlug,
        handoffMs: redirectedAt - submitStartedAt,
        createDraftResponse,
        startGenerationResponse: startGenerationResponseSummary,
      };
    }

    const scratchState = await readScratchSubmitState(page);
    if (scratchState.authScreen) {
      throw new Error(
        `Scratch submit unexpectedly returned to ${scratchState.authScreen} at ${page.url()}`,
      );
    }

    if (startGenerationResponseSummary?.waitError) {
      throw new Error(
        `startScratchGeneration did not return before the scratch handoff completed: ${startGenerationResponseSummary.waitError}`,
      );
    }
    if (startGenerationResponseSummary && !startGenerationResponseSummary.ok) {
      throw new Error(
        `startScratchGeneration failed: ${JSON.stringify({
          pageUrl: page.url(),
          scratchState,
          startGenerationResponse: startGenerationResponseSummary,
        })}`,
      );
    }

    if (
      startGenerationResponseSummary?.ok &&
      Date.now() - submitStartedAt >= 15_000
    ) {
      throw new Error(
        `Scratch submit received startScratchGeneration success but never navigated to the Studio route: ${JSON.stringify({
          pageUrl: page.url(),
          scratchState,
          startGenerationResponse: startGenerationResponseSummary,
        })}`,
      );
    }

    const elapsedMs = Date.now() - submitStartedAt;
    if (elapsedMs - lastProgressLogAt >= STUDIO_READY_PROGRESS_LOG_INTERVAL_MS) {
      lastProgressLogAt = elapsedMs;
      log(
        `Still waiting for scratch handoff [${elapsedMs}ms]: pageUrl=${page.url()} statusLabel=${scratchState.statusLabel ?? "none"} projectText=${scratchState.projectText ?? "none"} submitDisabled=${scratchState.submitDisabled} titleDisabled=${scratchState.titleDisabled} descriptionDisabled=${scratchState.descriptionDisabled} startGenerationResponse=${startGenerationResponseSummary ? "received" : "pending"}`,
      );
    }

    await sleep(1_000);
  }

  const scratchState = await readScratchSubmitState(page);
  await startGenerationResponsePromise.catch(() => undefined);
  throw new Error(
    `Scratch submit did not hand off to the Studio route within ${timeoutMs}ms: ${JSON.stringify({
      pageUrl: page.url(),
      scratchState,
      createDraftResponse,
      startGenerationResponse: startGenerationResponseSummary,
    })}`,
  );
}

async function waitForStudioReady(page, timeoutMs) {
  const readyTimeoutMs = Math.min(timeoutMs, DEFAULT_STUDIO_READY_TIMEOUT_MS);
  const iframeLocator = page.locator("iframe[title^='Vivd Studio -']");
  const startedAt = Date.now();
  let lastProgressLogAt = 0;

  while (Date.now() - startedAt < readyTimeoutMs) {
    const iframeVisible = await iframeLocator.first().isVisible().catch(() => false);
    const bootingVisible = await page
      .getByText(/Booting studio/i)
      .isVisible()
      .catch(() => false);
    const preparingVisible = await page
      .getByText(/Preparing your editor and dev server/i)
      .isVisible()
      .catch(() => false);
    const { iframeAttrSrc, iframeFrameUrl } = await readIframeNavigationState(
      iframeLocator,
    );
    const elapsedMs = Date.now() - startedAt;

    if (!iframeVisible) {
      if (elapsedMs - lastProgressLogAt >= STUDIO_READY_PROGRESS_LOG_INTERVAL_MS) {
        lastProgressLogAt = elapsedMs;
        log(
          `Still waiting for Studio iframe [${elapsedMs}ms]: bootingVisible=${bootingVisible} preparingVisible=${preparingVisible} iframeVisible=${iframeVisible} iframeAttrSrc=${iframeAttrSrc ?? "unknown"} iframeFrameUrl=${iframeFrameUrl ?? "unknown"}`,
        );
      }

      await sleep(1_000);
      continue;
    }

    const frame = page.frameLocator("iframe[title^='Vivd Studio -']");
    const newSessionButton = frame.getByRole("button", { name: "New session" });
    const chatComposer = frame.locator("textarea").first();
    const sendButton = frame.getByRole("button", { name: "Send message" });
    const stopButton = frame.getByRole("button", { name: "Stop generation" });
    const sessionContextButton = frame.locator(
      "[data-testid='session-context-usage-button']",
    );
    const firstUserMessage = frame.locator("[data-chat-user-row-id]").first();
    const newSessionVisible = await newSessionButton.isVisible().catch(() => false);
    const chatComposerVisible = await chatComposer.isVisible().catch(() => false);
    const sendButtonVisible = await sendButton.isVisible().catch(() => false);
    const stopButtonVisible = await stopButton.isVisible().catch(() => false);
    const sessionContextVisible = await sessionContextButton.isVisible().catch(() => false);
    const firstUserMessageVisible = await firstUserMessage.isVisible().catch(() => false);
    const hasInteractiveSignal =
      newSessionVisible ||
      sendButtonVisible ||
      stopButtonVisible ||
      sessionContextVisible ||
      firstUserMessageVisible;

    if (chatComposerVisible && hasInteractiveSignal) {
      return frame;
    }

    if (
      elapsedMs - lastProgressLogAt >= STUDIO_READY_PROGRESS_LOG_INTERVAL_MS
    ) {
      lastProgressLogAt = elapsedMs;
      log(
        `Still waiting for Studio UI [${elapsedMs}ms]: bootingVisible=${bootingVisible} preparingVisible=${preparingVisible} iframeVisible=${iframeVisible} newSessionVisible=${newSessionVisible} sendButtonVisible=${sendButtonVisible} stopButtonVisible=${stopButtonVisible} sessionContextVisible=${sessionContextVisible} firstUserMessageVisible=${firstUserMessageVisible} chatComposerVisible=${chatComposerVisible} iframeAttrSrc=${iframeAttrSrc ?? "unknown"} iframeFrameUrl=${iframeFrameUrl ?? "unknown"}`,
      );
    }

    await sleep(1_000);
  }

  const { iframeAttrSrc, iframeFrameUrl } = await readIframeNavigationState(
    iframeLocator,
  );
  const frame = page.frameLocator("iframe[title^='Vivd Studio -']");
  const sendButton = frame.getByRole("button", { name: "Send message" });
  const stopButton = frame.getByRole("button", { name: "Stop generation" });
  const sessionContextButton = frame.locator(
    "[data-testid='session-context-usage-button']",
  );
  const firstUserMessage = frame.locator("[data-chat-user-row-id]").first();
  const diagnostics = {
    pageUrl: page.url(),
    iframeAttrSrc,
    iframeFrameUrl,
    bootingVisible: await page.getByText(/Booting studio/i).isVisible().catch(() => false),
    preparingVisible: await page
      .getByText(/Preparing your editor and dev server/i)
      .isVisible()
      .catch(() => false),
    newSessionVisible: await frame
      .getByRole("button", { name: "New session" })
      .isVisible()
      .catch(() => false),
    sendButtonVisible: await sendButton.isVisible().catch(() => false),
    stopButtonVisible: await stopButton.isVisible().catch(() => false),
    sessionContextVisible: await sessionContextButton.isVisible().catch(() => false),
    firstUserMessageVisible: await firstUserMessage.isVisible().catch(() => false),
    chatComposerVisible: await frame.locator("textarea").first().isVisible().catch(() => false),
  };

  throw new Error(
    `Studio did not become ready within ${readyTimeoutMs}ms after the iframe appeared. Diagnostics: ${JSON.stringify(
      diagnostics,
    )}`,
  );
}

function readSessionIdFromUrl(urlString) {
  try {
    return new URL(urlString).searchParams.get("sessionId")?.trim() || null;
  } catch {
    return null;
  }
}

function isBlankIframeUrl(urlString) {
  if (typeof urlString !== "string") return true;
  const trimmed = urlString.trim();
  return !trimmed || trimmed === "about:blank";
}

function resolveStudioTrpcUrl(appUrl) {
  const url = new URL(appUrl);
  const marker = "/vivd-studio";
  const markerIndex = url.pathname.indexOf(marker);
  const runtimePrefix = markerIndex >= 0 ? url.pathname.slice(0, markerIndex) : "";
  url.pathname = `${runtimePrefix}/vivd-studio/api/trpc`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function resolveStudioTrpcUrlFromFrame(frame, fallbackUrl) {
  const fallbackResolved = resolveStudioTrpcUrl(fallbackUrl);
  if (!frame) {
    return fallbackResolved;
  }

  try {
    const frameUrl = await frame.locator("html").evaluate(() => window.location.href);
    if (typeof frameUrl === "string" && frameUrl.trim() && frameUrl !== "about:blank") {
      return resolveStudioTrpcUrl(frameUrl);
    }
  } catch {
    // Fall back to URL-based inference below.
  }

  return fallbackResolved;
}

function readStudioTokenFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const queryToken = url.searchParams.get("vivdStudioToken")?.trim();
    if (queryToken) return queryToken;

    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hash);
    return hashParams.get("vivdStudioToken")?.trim() || null;
  } catch {
    return null;
  }
}

function rewriteLocalhostUrlToIpv4(urlString) {
  const url = new URL(urlString);
  const originalHost = url.host;
  if (!url.hostname.endsWith(".localhost")) {
    return null;
  }

  url.hostname = "127.0.0.1";
  return {
    rewrittenUrl: url.toString(),
    originalHost,
  };
}

async function readStudioTrpcQuery(requestContext, trpcUrl, procedureName, input, studioToken) {
  const queryUrl = new URL(
    `${trpcUrl.replace(/\/+$/u, "")}/${procedureName}`,
  );
  queryUrl.searchParams.set("batch", "1");
  queryUrl.searchParams.set("input", JSON.stringify({ 0: input }));
  const headers = {};
  if (typeof studioToken === "string" && studioToken.trim()) {
    headers[STUDIO_AUTH_HEADER] = studioToken.trim();
  }

  const response = await requestContext.get(queryUrl.toString(), {
    headers,
    failOnStatusCode: false,
  });
  const body = await response.text();

  if (!response.ok()) {
    const detail = body.trim();
    throw new Error(
      detail
        ? `${procedureName} failed (${response.status()}) [${queryUrl.toString()}]: ${detail}`
        : `${procedureName} failed (${response.status()}) [${queryUrl.toString()}]`,
    );
  }

  const payload = JSON.parse(body);
  const result = Array.isArray(payload) ? payload[0] : payload;
  return result?.result?.data?.json ?? result?.result?.data ?? result;
}

function countRecordedInitialGenerationActions(messages) {
  let total = 0;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.info?.role !== "assistant") continue;

    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const part of parts) {
      if (part?.type === "tool") {
        const status =
          typeof part?.status === "string"
            ? part.status
            : typeof part?.state?.status === "string"
              ? part.state.status
              : null;
        if (status === "running") continue;
        total += 1;
        continue;
      }

      if (part?.type === "reasoning" || part?.type === "text") {
        const text = typeof part?.text === "string" ? part.text.trim() : "";
        if (text) {
          total += 1;
        }
      }
    }

    if (
      parts.length === 0 &&
      typeof message?.content === "string" &&
      message.content.trim()
    ) {
      total += 1;
    }
  }

  return total;
}

async function readInitialGenerationProgress(options) {
  const bootstrapResult = await Promise.allSettled([
    readStudioTrpcQuery(
      options.requestContext,
      options.trpcUrl,
      "agentChat.bootstrap",
      {
        sessionId: options.sessionId,
        projectSlug: options.projectSlug,
        version: options.version,
      },
      options.studioToken,
    ),
  ]);

  const bootstrap =
    bootstrapResult[0]?.status === "fulfilled"
      ? bootstrapResult[0].value
      : null;
  const messages = Array.isArray(bootstrap?.messages) ? bootstrap.messages : [];
  const statuses =
    bootstrap && typeof bootstrap === "object" && bootstrap.statuses
      ? bootstrap.statuses
      : null;
  const bootstrapError =
    bootstrapResult[0]?.status === "rejected"
      ? bootstrapResult[0].reason instanceof Error
        ? bootstrapResult[0].reason.message
        : String(bootstrapResult[0].reason)
      : null;

  return {
    actionCount: countRecordedInitialGenerationActions(messages),
    sessionStatus: statuses?.[options.sessionId] ?? null,
    messagesError: bootstrapError,
    statusesError: bootstrapError,
  };
}

async function probeSessionHistoryForSessionEvidence(frame, timeoutMs) {
  const sessionToggleButton = frame
    .getByRole("button", { name: /Show sessions|Hide sessions/i })
    .first();
  const sessionListHeading = frame.getByText("Latest Sessions").first();
  const sessionRow = frame.locator("[data-testid^='session-row-']").first();
  const sessionActivityIndicator = frame
    .locator("[data-testid^='session-activity-indicator-']")
    .first();
  const chatComposer = frame.locator("textarea").first();

  if (!(await sessionToggleButton.isVisible().catch(() => false))) {
    return null;
  }

  const historyInitiallyOpen = await frame
    .getByRole("button", { name: "Hide sessions" })
    .isVisible()
    .catch(() => false);

  if (!historyInitiallyOpen) {
    await sessionToggleButton.click();
  }

  try {
    await expectVisible(
      sessionListHeading,
      Math.min(timeoutMs, DEFAULT_GENERATION_STOP_OPPORTUNITY_TIMEOUT_MS),
      "session history heading",
    );

    const sessionState = await waitForVisibleState(
      [
        { name: "session-activity-indicator", locator: sessionActivityIndicator },
        { name: "session-row", locator: sessionRow },
      ],
      Math.min(timeoutMs, DEFAULT_GENERATION_STOP_OPPORTUNITY_TIMEOUT_MS),
    );

    return sessionState;
  } finally {
    if (!historyInitiallyOpen) {
      await sessionToggleButton.click().catch(() => undefined);
      await chatComposer.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    }
  }
}

async function settleInitialGeneration(page, frame, timeoutMs, options) {
  const minRecordedActions = readNonNegativeIntEnv(
    "VIVD_STUDIO_HOST_SMOKE_MIN_RECORDED_ACTIONS",
    DEFAULT_INITIAL_GENERATION_MIN_RECORDED_ACTIONS,
  );
  const iframeLocator = page.locator("iframe[title^='Vivd Studio -']");
  const stopButton = frame.getByRole("button", { name: "Stop generation" });
  const sendButton = frame.getByRole("button", { name: "Send message" });
  const chatComposer = frame.locator("textarea").first();
  const sessionContextButton = frame.locator(
    "[data-testid='session-context-usage-button']",
  );
  const assistantActivityLabel = frame
    .getByText(/^(Thought|Thinking\b|Working\b)/i)
    .first();
  const firstUserMessage = frame.locator("[data-chat-user-row-id]").first();
  const agentQuestionHeader = frame.getByText(/Agent Question/i).first();
  const baseSettleTimeoutMs = Math.min(
    timeoutMs,
    DEFAULT_GENERATION_SETTLE_TIMEOUT_MS,
  );
  let settleTimeoutMs = baseSettleTimeoutMs;
  const startedAt = Date.now();
  let sessionIdFromUrl = null;
  let lastVisibleState = null;
  let lastRecordedActionCount = 0;
  let lastProgressEvidenceCount = 0;
  let lastSessionStatus = null;
  let lastProgressError = null;
  let lastSessionHistoryEvidence = null;
  let lastSessionHistoryProbeAt = 0;
  let trpcUrl = null;
  let studioToken = null;
  let busyGraceApplied = false;

  while (true) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= settleTimeoutMs) {
      const shouldExtendForActiveRun =
        !busyGraceApplied &&
        lastRecordedActionCount > 0 &&
        lastRecordedActionCount < minRecordedActions &&
        (lastSessionStatus === "busy" ||
          lastSessionStatus === "retry" ||
          lastVisibleState === "stop" ||
          lastVisibleState === "assistant-activity");

      if (shouldExtendForActiveRun) {
        const extendedSettleTimeoutMs = Math.min(
          timeoutMs,
          baseSettleTimeoutMs + DEFAULT_GENERATION_BUSY_GRACE_TIMEOUT_MS,
        );
        if (extendedSettleTimeoutMs > settleTimeoutMs) {
          settleTimeoutMs = extendedSettleTimeoutMs;
          busyGraceApplied = true;
          log(
            `Initial generation is still active after ${elapsedMs}ms (recordedActions=${lastRecordedActionCount} status=${lastSessionStatus ?? "unknown"}); allowing ${extendedSettleTimeoutMs - baseSettleTimeoutMs}ms extra to reach ${minRecordedActions} recorded actions`,
          );
          continue;
        }
      }

      break;
    }

    const remainingMs = settleTimeoutMs - elapsedMs;
    if (remainingMs <= 0) break;

    const visibleState = await waitForVisibleState(
      [
        { name: "stop", locator: stopButton },
        { name: "assistant-activity", locator: assistantActivityLabel },
        { name: "user-message", locator: firstUserMessage },
        { name: "session-context", locator: sessionContextButton },
        { name: "agent-question", locator: agentQuestionHeader },
      ],
      Math.min(remainingMs, INITIAL_GENERATION_ACTION_POLL_MS),
    ).catch(() => null);

    lastVisibleState = visibleState ?? lastVisibleState;
    const { iframeAttrSrc, iframeFrameUrl } = await readIframeNavigationState(
      iframeLocator,
    );
    sessionIdFromUrl =
      readSessionIdFromUrl(page.url()) ??
      readSessionIdFromUrl(iframeFrameUrl) ??
      readSessionIdFromUrl(iframeAttrSrc) ??
      sessionIdFromUrl;

    if (sessionIdFromUrl) {
      trpcUrl =
        trpcUrl ??
        (await resolveStudioTrpcUrlFromFrame(
          frame,
          isBlankIframeUrl(iframeFrameUrl)
            ? iframeAttrSrc ?? page.url()
            : iframeFrameUrl,
        ));
      studioToken =
        studioToken ??
        readStudioTokenFromUrl(iframeFrameUrl) ??
        readStudioTokenFromUrl(iframeAttrSrc) ??
        readStudioTokenFromUrl(page.url()) ??
        null;

      try {
        const progress = await readInitialGenerationProgress({
          requestContext: page.context().request,
          trpcUrl,
          studioToken,
          sessionId: sessionIdFromUrl,
          projectSlug: options.projectSlug,
          version: options.version,
        });
        lastRecordedActionCount = progress.actionCount;
        lastSessionStatus = progress.sessionStatus?.type ?? null;
        lastProgressError = [progress.messagesError, progress.statusesError]
          .filter(Boolean)
          .join("; ") || null;
      } catch (error) {
        lastProgressError = error instanceof Error ? error.message : String(error);
      }
    }

    const uiProgressEvidence =
      lastVisibleState === "stop" ||
      lastVisibleState === "assistant-activity" ||
      lastVisibleState === "agent-question"
        ? 1
        : 0;

    const shouldProbeSessionHistory =
      Boolean(sessionIdFromUrl) &&
      lastRecordedActionCount === 0 &&
      Date.now() - lastSessionHistoryProbeAt >=
        INITIAL_GENERATION_SESSION_HISTORY_PROBE_INTERVAL_MS &&
      (lastProgressError ||
        lastSessionStatus === "busy" ||
        lastSessionStatus === "retry" ||
        lastVisibleState === "user-message");

    if (shouldProbeSessionHistory) {
      lastSessionHistoryProbeAt = Date.now();
      lastSessionHistoryEvidence = await probeSessionHistoryForSessionEvidence(
        frame,
        Math.min(remainingMs, DEFAULT_GENERATION_STOP_OPPORTUNITY_TIMEOUT_MS),
      ).catch(() => lastSessionHistoryEvidence);
    }

    const sessionHistoryEvidence =
      lastSessionHistoryEvidence === "session-activity-indicator" ||
      (lastSessionHistoryEvidence === "session-row" &&
        (lastSessionStatus === "busy" || lastSessionStatus === "retry"))
        ? 1
        : 0;

    lastProgressEvidenceCount = Math.max(
      lastRecordedActionCount,
      uiProgressEvidence,
      sessionHistoryEvidence,
    );

    if (lastRecordedActionCount >= minRecordedActions) {
      log(
        `Observed initial-generation progress for session ${sessionIdFromUrl ?? "unknown"} (recordedActions=${lastRecordedActionCount} evidence=${lastProgressEvidenceCount} status=${lastSessionStatus ?? "unknown"} history=${lastSessionHistoryEvidence ?? "none"}); checking for a stop opportunity`,
      );

      if (await stopButton.isVisible().catch(() => false)) {
        await sleep(5_000);
        if (await stopButton.isVisible().catch(() => false)) {
          await stopButton.click({ timeout: 5_000 });
          await expectVisible(
            sendButton,
            settleTimeoutMs,
            "send button after stop",
          );
          return `stopped-after-${lastRecordedActionCount}-recorded-actions`;
        }
      }

      return `observed-${lastRecordedActionCount}-recorded-actions`;
    }

    await sleep(INITIAL_GENERATION_ACTION_POLL_MS);
  }

  const sendButtonVisible = await sendButton.isVisible().catch(() => false);
  const chatComposerVisible = await chatComposer.isVisible().catch(() => false);

  throw new Error(
    `Initial generation did not reach ${minRecordedActions} recorded action(s) within ${settleTimeoutMs}ms (sessionId=${sessionIdFromUrl ?? "none"} recordedActions=${lastRecordedActionCount} progressEvidence=${lastProgressEvidenceCount} sessionStatus=${lastSessionStatus ?? "none"} visibleState=${lastVisibleState ?? "none"} sessionHistoryEvidence=${lastSessionHistoryEvidence ?? "none"} busyGraceApplied=${busyGraceApplied} sendButtonVisible=${sendButtonVisible} chatComposerVisible=${chatComposerVisible}${lastProgressError ? ` progressError=${lastProgressError}` : ""})`,
  );
}

function collectKnownBadMessages(messages) {
  return messages.filter((entry) =>
    FAILING_CONSOLE_PATTERNS.some((pattern) => pattern.test(entry.text)),
  );
}

function collectNonFatalConsoleMessages(messages) {
  return messages.filter((entry) =>
    NON_FATAL_CONSOLE_PATTERNS.some((pattern) => pattern.test(entry.text)),
  );
}

function isStudioBootstrapUrl(url) {
  return typeof url === "string" && url.includes("/vivd-studio/api/bootstrap");
}

function recordBootstrapResponse(target, response) {
  const request = response.request();
  if (!isStudioBootstrapUrl(request.url())) return;

  target.push({
    kind: "response",
    method: request.method(),
    url: request.url(),
    status: response.status(),
    ok: response.ok(),
  });
}

function recordBootstrapRequestFailure(target, request) {
  if (!isStudioBootstrapUrl(request.url())) return;

  target.push({
    kind: "requestfailed",
    method: request.method(),
    url: request.url(),
    failureText: request.failure()?.errorText ?? "unknown",
  });
}

function recordChildFrameNavigation(target, frame, page) {
  if (frame.parentFrame() !== page.mainFrame()) return;

  target.push({
    url: frame.url(),
    name: frame.name(),
  });
}

async function readBootstrapFormState(page) {
  return await page
    .evaluate(() => {
      const form = document.querySelector('form[target^="vivd-studio-"]');
      if (!form) return null;

      const nextField = form.querySelector('input[name="next"]');
      const bootstrapTokenField = form.querySelector('input[name="bootstrapToken"]');
      const userActionTokenField = form.querySelector(
        'input[name="userActionToken"]',
      );

      return {
        action:
          form instanceof HTMLFormElement && form.action ? form.action : null,
        target:
          form instanceof HTMLFormElement && form.target ? form.target : null,
        next:
          nextField instanceof HTMLInputElement && nextField.value
            ? nextField.value
            : null,
        hasBootstrapToken:
          bootstrapTokenField instanceof HTMLInputElement &&
          Boolean(bootstrapTokenField.value),
        hasUserActionToken:
          userActionTokenField instanceof HTMLInputElement &&
          Boolean(userActionTokenField.value),
      };
    })
    .catch(() => null);
}

function formatErrorForLog(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

async function main() {
  const baseEnv = loadLocalEnv(process.env);
  const pwDebugEnabled = isPwDebugEnabled(baseEnv);
  const timeoutMs = readPositiveIntEnv(
    "VIVD_STUDIO_HOST_SMOKE_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    baseEnv,
  );
  const hostPort = readPositiveIntEnv(
    "VIVD_STUDIO_HOST_SMOKE_PORT",
    DEFAULT_HOST_SMOKE_PORT,
    baseEnv,
  );
  const studioImage =
    getOptionalEnv("STUDIO_IMAGE", baseEnv) ||
    getOptionalEnv("DOCKER_STUDIO_IMAGE", baseEnv) ||
    DEFAULT_STUDIO_IMAGE;
  const modelOverride =
    getOptionalEnv("VIVD_STUDIO_HOST_SMOKE_MODEL", baseEnv) ||
    getOptionalEnv("OPENCODE_MODEL_STANDARD", baseEnv) ||
    DEFAULT_HOST_SMOKE_FALLBACK_MODEL;
  const headless = readBooleanEnv(
    "VIVD_STUDIO_HOST_SMOKE_HEADLESS",
    !pwDebugEnabled,
    baseEnv,
  );
  const devtools = readBooleanEnv(
    "VIVD_STUDIO_HOST_SMOKE_DEVTOOLS",
    pwDebugEnabled,
    baseEnv,
  );
  const pauseOnFailure = readBooleanEnv(
    "VIVD_STUDIO_HOST_SMOKE_PAUSE_ON_FAILURE",
    pwDebugEnabled,
    baseEnv,
  );
  const slowMoMs = readNonNegativeIntEnv(
    "VIVD_STUDIO_HOST_SMOKE_SLOW_MO_MS",
    pwDebugEnabled ? 250 : 0,
    baseEnv,
  );

  if (!getOptionalEnv("OPENROUTER_API_KEY", baseEnv) && modelOverride.startsWith("openrouter/")) {
    throw new Error(
      "Studio host smoke requires OPENROUTER_API_KEY when using an OpenRouter model.",
    );
  }

  const controlPlaneOrigin = buildHttpOrigin(DEFAULT_CONTROL_PLANE_HOSTNAME, hostPort);
  const tenantOrigin = buildHttpOrigin(DEFAULT_TENANT_HOSTNAME, hostPort);
  const docsOrigin = buildHttpOrigin(DEFAULT_DOCS_HOSTNAME, hostPort);
  const pausedPortContainers = await acquireHostPort(hostPort, baseEnv);

  const composeProject = `vivd-host-smoke-${randomUUID().slice(0, 8)}`;
  const workDir = process.cwd();
  const artifactDir = mkdtempSync(
    path.join(os.tmpdir(), "vivd-studio-host-smoke-"),
  );
  const screenshotPath = path.join(artifactDir, "failure.png");
  const metricsPath = path.join(artifactDir, "metrics.json");
  const composeLogsPath = path.join(artifactDir, "compose.log");
  const smokeEnv = {
    ...baseEnv,
    VIVD_STUDIO_HOST_SMOKE_PORT: String(hostPort),
    POSTGRES_USER: getOptionalEnv("POSTGRES_USER", baseEnv) || "postgres",
    POSTGRES_PASSWORD:
      getOptionalEnv("POSTGRES_PASSWORD", baseEnv) || "password",
    POSTGRES_DB: getOptionalEnv("POSTGRES_DB", baseEnv) || "vivd_host_smoke",
    BETTER_AUTH_SECRET:
      getOptionalEnv("BETTER_AUTH_SECRET", baseEnv) ||
      "vivd-host-smoke-secret",
    SCRAPER_API_KEY:
      getOptionalEnv("SCRAPER_API_KEY", baseEnv) || "vivd-host-smoke-scraper",
    DOMAIN: controlPlaneOrigin,
    BETTER_AUTH_URL: controlPlaneOrigin,
    VIVD_APP_URL: controlPlaneOrigin,
    VIVD_INSTALL_PROFILE: "platform",
    TENANT_DOMAIN_ROUTING_ENABLED: "true",
    TENANT_BASE_DOMAIN: "localhost",
    CONTROL_PLANE_HOST: `${DEFAULT_CONTROL_PLANE_HOSTNAME}:${hostPort}`,
    SUPERADMIN_HOSTS: `${DEFAULT_CONTROL_PLANE_HOSTNAME}:${hostPort},${DEFAULT_TENANT_HOSTNAME}:${hostPort}`,
    TRUSTED_DOMAINS: `${DEFAULT_CONTROL_PLANE_HOSTNAME}:${hostPort},${DEFAULT_TENANT_HOSTNAME}:${hostPort}`,
    VIVD_DOCS_HOST: `${DEFAULT_DOCS_HOSTNAME}:${hostPort}`,
    VIVD_DOCS_SITE_URL: docsOrigin,
    VIVD_EMAIL_PROVIDER: getOptionalEnv("VIVD_EMAIL_PROVIDER", baseEnv) || "noop",
    VIVD_AUTH_EMAIL_VERIFICATION_SEND_ON_SIGNUP: "false",
    VIVD_AUTH_EMAIL_VERIFICATION_SEND_ON_SIGNIN: "false",
    VIVD_AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    VIVD_SCRATCH_CREATION_MODE: "studio_astro",
    STUDIO_MACHINE_PROVIDER: "docker",
    DOCKER_STUDIO_IMAGE: studioImage,
    DOCKER_STUDIO_NETWORK: `${composeProject}_vivd-network`,
    DOCKER_STUDIO_PUBLIC_BASE_URL: controlPlaneOrigin,
    DOCKER_STUDIO_INTERNAL_PROXY_BASE_URL: "http://caddy",
    OPENCODE_MODEL_STANDARD: modelOverride,
  };

  const credentials = {
    name: "Smoke Admin",
    email: `smoke-${randomUUID().slice(0, 8)}@example.com`,
    password: `Smoke-${randomUUID().slice(0, 8)}-Pass!`,
  };

  let browser;
  let currentPage = null;
  let createdProjectSlug = null;
  const consoleMessages = [];
  const pageErrors = [];
  const metrics = { checkpoints: [] };
  const bootstrapEvents = [];
  const iframeNavigations = [];
  const startedAt = Date.now();
  let succeeded = false;
  let fatalError = null;

  try {
    log(`Using Studio image ${studioImage}`);
    log(`Using default smoke model ${modelOverride}`);
    log(`Using host smoke origins ${controlPlaneOrigin} and ${tenantOrigin}`);
    log(
      `Browser mode headless=${headless} devtools=${devtools} slowMoMs=${slowMoMs} pauseOnFailure=${pauseOnFailure}`,
    );
    log(`Artifacts: ${artifactDir}`);

    markCheckpoint(metrics.checkpoints, "compose_starting", startedAt, {
      composeProject,
    });
    runDockerCompose(
      composeProject,
      ["up", "--detach", "--build", "--remove-orphans"],
      { cwd: workDir, env: smokeEnv },
    );
    markCheckpoint(metrics.checkpoints, "compose_started", startedAt, {
      composeProject,
    });

    await waitForHealth(`http://127.0.0.1:${hostPort}/health`, timeoutMs);
    await waitForHealth(
      `${controlPlaneOrigin}/vivd-studio/api/health`,
      timeoutMs,
    );
    markCheckpoint(metrics.checkpoints, "host_healthy", startedAt, {
      origin: controlPlaneOrigin,
    });

    browser = await chromium.launch({
      headless,
      devtools,
      slowMo: slowMoMs > 0 ? slowMoMs : undefined,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    currentPage = page;
    markCheckpoint(metrics.checkpoints, "browser_ready", startedAt);

    page.on("console", (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
      });
    });
    page.on("response", (response) => {
      recordBootstrapResponse(bootstrapEvents, response);
    });
    page.on("requestfailed", (request) => {
      recordBootstrapRequestFailure(bootstrapEvents, request);
    });
    page.on("framenavigated", (frame) => {
      recordChildFrameNavigation(iframeNavigations, frame, page);
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });

    const authStartedAt = Date.now();
    await authenticateOnHost({
      page,
      origin: controlPlaneOrigin,
      credentials,
      timeoutMs,
    });
    metrics.controlPlaneAuthMs = Date.now() - authStartedAt;
    markCheckpoint(metrics.checkpoints, "control_plane_authenticated", startedAt, {
      origin: controlPlaneOrigin,
    });

    const scratch = await createScratchProject({
      page,
      controlPlaneOrigin,
      credentials,
      timeoutMs,
    });
    createdProjectSlug = scratch.projectSlug;
    metrics.scratchHandoffMs = scratch.handoffMs;
    metrics.controlPlaneScratchSubmit = {
      createDraftResponse: scratch.createDraftResponse ?? null,
      startGenerationResponse: scratch.startGenerationResponse ?? null,
    };
    markCheckpoint(metrics.checkpoints, "studio_route_opened", startedAt, {
      projectSlug: createdProjectSlug,
    });
    metrics.controlPlaneBootstrapForm = await readBootstrapFormState(page);

    const studioReadyStartedAt = Date.now();
    const controlPlaneFrame = await waitForStudioReady(page, timeoutMs);
    metrics.controlPlaneStudioReadyMs = Date.now() - studioReadyStartedAt;
    markCheckpoint(metrics.checkpoints, "control_plane_studio_ready", startedAt, {
      projectSlug: createdProjectSlug,
    });

    const initialGenerationOutcome = await settleInitialGeneration(
      page,
      controlPlaneFrame,
      timeoutMs,
      {
        projectSlug: createdProjectSlug,
        version: 1,
      },
    );
    markCheckpoint(metrics.checkpoints, "initial_generation_settled", startedAt, {
      projectSlug: createdProjectSlug,
      outcome: initialGenerationOutcome,
    });
    const controlPlaneInteractiveFrame = await waitForStudioReady(page, timeoutMs);
    await controlPlaneInteractiveFrame.locator("textarea").first().fill(
      "Smoke follow-up draft only. Do not send.",
    );
    const sendButton = controlPlaneInteractiveFrame.getByRole("button", {
      name: "Send message",
    });
    await expectVisible(sendButton, timeoutMs, "send button after typing");
    assert.equal(
      await sendButton.isEnabled(),
      true,
      "Expected the send button to be enabled after typing a follow-up draft.",
    );

    const tenantPage = await context.newPage();
    currentPage = tenantPage;
    tenantPage.on("console", (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
      });
    });
    tenantPage.on("response", (response) => {
      recordBootstrapResponse(bootstrapEvents, response);
    });
    tenantPage.on("requestfailed", (request) => {
      recordBootstrapRequestFailure(bootstrapEvents, request);
    });
    tenantPage.on("framenavigated", (frame) => {
      recordChildFrameNavigation(iframeNavigations, frame, tenantPage);
    });
    tenantPage.on("pageerror", (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });

    const tenantAuthStartedAt = Date.now();
    await authenticateOnHost({
      page: tenantPage,
      origin: tenantOrigin,
      credentials,
      timeoutMs,
    });
    metrics.tenantAuthMs = Date.now() - tenantAuthStartedAt;
    markCheckpoint(metrics.checkpoints, "tenant_authenticated", startedAt, {
      origin: tenantOrigin,
    });

    await tenantPage.goto(
      `${tenantOrigin}/vivd-studio/projects/${createdProjectSlug}?view=studio&version=1`,
      { waitUntil: "domcontentloaded" },
    );
    metrics.tenantBootstrapForm = await readBootstrapFormState(tenantPage);
    const tenantReadyStartedAt = Date.now();
    await waitForStudioReady(tenantPage, timeoutMs);
    metrics.tenantStudioReadyMs = Date.now() - tenantReadyStartedAt;
    markCheckpoint(metrics.checkpoints, "tenant_studio_ready", startedAt, {
      projectSlug: createdProjectSlug,
    });

    const badConsoleMessages = collectKnownBadMessages(consoleMessages);
    const nonFatalConsoleMessages = collectNonFatalConsoleMessages(consoleMessages);
    assert.equal(
      badConsoleMessages.length,
      0,
      `Observed known-bad console/runtime messages:\n${badConsoleMessages
        .map((entry) => `${entry.type}: ${entry.text}`)
        .join("\n")}`,
    );
    assert.equal(
      pageErrors.length,
      0,
      `Observed page errors:\n${pageErrors.join("\n")}`,
    );

    if (nonFatalConsoleMessages.length > 0) {
      metrics.nonFatalConsoleMessages = nonFatalConsoleMessages;
      log(
        `Observed ${nonFatalConsoleMessages.length} non-fatal console/runtime warning(s); keeping artifact for follow-up cleanup`,
      );
    }

    writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
    log(`Metrics:\n${JSON.stringify(metrics, null, 2)}`);
    log(`Smoke passed for ${createdProjectSlug}`);
    succeeded = true;
  } catch (error) {
    fatalError = error;
  } finally {
    if (!succeeded) {
      const lastCheckpoint = metrics.checkpoints.at(-1)?.name ?? "none";
      log(`Smoke failed after checkpoint: ${lastCheckpoint}`);
      if (fatalError) {
        metrics.failure = {
          lastCheckpoint,
          message: fatalError instanceof Error ? fatalError.message : String(fatalError),
        };
      }
      if (consoleMessages.length > 0) {
        metrics.consoleMessages = consoleMessages;
      }
      if (pageErrors.length > 0) {
        metrics.pageErrors = pageErrors;
      }
      if (bootstrapEvents.length > 0) {
        metrics.bootstrapEvents = bootstrapEvents;
      }
      if (iframeNavigations.length > 0) {
        metrics.iframeNavigations = iframeNavigations;
      }
      writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
      log(`Saved partial metrics to ${metricsPath}`);
      if (fatalError) {
        console.error(`[studio-docker-host-smoke] Root failure:\n${formatErrorForLog(fatalError)}`);
      }

      if (currentPage) {
        try {
          await currentPage.screenshot({ path: screenshotPath, fullPage: true });
          log(`Saved failure screenshot to ${screenshotPath}`);
        } catch (error) {
          log(`Could not capture failure screenshot: ${String(error)}`);
        }

        try {
          log(`Current page URL: ${currentPage.url()}`);
        } catch {
          // Best effort.
        }
      }

      try {
        const composePs = runDockerCompose(
          composeProject,
          ["ps", "--all"],
          { cwd: workDir, env: smokeEnv, allowFailure: true },
        );
        if (composePs.stdout.trim()) {
          console.error(composePs.stdout.trim());
        }
      } catch {
        // Best effort.
      }

      try {
        const composeLogs = runDockerCompose(
          composeProject,
          ["logs", "--tail", "80"],
          { cwd: workDir, env: smokeEnv, allowFailure: true },
        );
        const combinedLogs = `${composeLogs.stdout}${composeLogs.stderr}`.trim();
        if (combinedLogs) {
          writeFileSync(composeLogsPath, `${combinedLogs}\n`, "utf8");
          log(`Saved compose logs to ${composeLogsPath}`);
        }
      } catch {
        // Best effort.
      }

      if (pauseOnFailure) {
        await pauseForInspection(
          `Paused after failure with compose project ${composeProject}`,
        );
      }
    }

    if (browser) {
      await browser.close().catch(() => undefined);
    }

    const managedStudioContainers = listManagedStudioContainersOnNetwork(
      smokeEnv.DOCKER_STUDIO_NETWORK,
    );
    if (managedStudioContainers.length > 0) {
      removeContainers(managedStudioContainers);
    }

    runDockerCompose(
      composeProject,
      ["down", "--volumes", "--remove-orphans"],
      { cwd: workDir, env: smokeEnv, allowFailure: true },
    );

    if (pausedPortContainers.length > 0) {
      restartContainers(pausedPortContainers);
    }

    if (succeeded) {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  }

  if (fatalError) {
    throw fatalError;
  }
}

main().catch((error) => {
  const message = formatErrorForLog(error);
  console.error(`[studio-docker-host-smoke] ${message}`);
  process.exitCode = 1;
});
