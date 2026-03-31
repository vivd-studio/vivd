#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_PORT_TAKEOVER_TIMEOUT_MS = 30_000;
const PORT_TAKEOVER_POLL_INTERVAL_MS = 500;
const DEFAULT_STUDIO_IMAGE = "vivd-studio:release-smoke";
const DEFAULT_CONTROL_PLANE_ORIGIN = "http://app.localhost";
const DEFAULT_TENANT_ORIGIN = "http://default.localhost";
const DEFAULT_CHEAP_OPENROUTER_MODEL = "openrouter/google/gemini-2.5-flash";
const KNOWN_BAD_CONSOLE_PATTERNS = [
  /invalid bootstrap target/i,
  /localhost:undefined/i,
  /blocked by cors policy/i,
  /\/health'.*has been blocked by cors policy/i,
  /api\/bootstrap.*400 \(bad request\)/i,
];

function log(message) {
  console.log(`[studio-docker-host-smoke] ${message}`);
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

function readPositiveIntEnv(name, fallback, env = process.env) {
  const raw = getOptionalEnv(name, env);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function canTakeOverPort80(env) {
  const raw = getOptionalEnv("VIVD_STUDIO_HOST_SMOKE_TAKEOVER_PORT_80", env);
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

async function ensurePortBindable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

function describeListeningPort(port) {
  const result = runCommand(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
    { allowFailure: true },
  );
  return `${result.stdout}${result.stderr}`.trim();
}

async function waitForPortBindable(port, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await ensurePortBindable(port);
      return;
    } catch (error) {
      lastError = error;
      await sleep(PORT_TAKEOVER_POLL_INTERVAL_MS);
    }
  }

  const portDescription = describeListeningPort(port);
  const suffix = portDescription
    ? ` Remaining listener(s):\n${portDescription}`
    : "";
  throw new Error(
    `Port ${port} did not become available within ${timeoutMs}ms.${suffix}`,
    lastError ? { cause: lastError } : undefined,
  );
}

function listPort80ComposeCaddies() {
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
        /(^|,|\s)(0\.0\.0\.0|127\.0\.0\.1|\[::\]|::):80->80\/tcp/i.test(entry.ports),
    );
}

async function acquirePort80(env) {
  const takeoverTimeoutMs = readPositiveIntEnv(
    "VIVD_STUDIO_HOST_SMOKE_PORT_TAKEOVER_TIMEOUT_MS",
    DEFAULT_PORT_TAKEOVER_TIMEOUT_MS,
    env,
  );

  try {
    await ensurePortBindable(80);
    return [];
  } catch {
    const portDescription = describeListeningPort(80);
    if (!canTakeOverPort80(env)) {
      throw new Error(
        `Port 80 is already in use. Re-run with VIVD_STUDIO_HOST_SMOKE_TAKEOVER_PORT_80=1 to temporarily pause the local Caddy dev proxy during the smoke.${
          portDescription ? ` Current listener(s):\n${portDescription}` : ""
        }`,
      );
    }

    const caddies = listPort80ComposeCaddies();
    if (caddies.length === 0) {
      throw new Error(
        "Port 80 is already in use, but no compose-managed Caddy container could be identified for temporary takeover.",
      );
    }

    log(
      `Temporarily stopping port-80 Caddy container(s): ${caddies
        .map((entry) => entry.name)
        .join(", ")}`,
    );
    for (const entry of caddies) {
      runCommand("docker", ["stop", entry.id]);
    }

    try {
      await waitForPortBindable(80, takeoverTimeoutMs);
    } catch (error) {
      throw new Error(
        "Port 80 is still busy after stopping the local Caddy container(s).",
        { cause: error },
      );
    }

    return caddies;
  }
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

async function authenticateOnHost(page, origin, credentials, timeoutMs) {
  await page.goto(`${origin}/vivd-studio`, { waitUntil: "domcontentloaded" });

  const signupButton = page.getByRole("button", { name: "Create Admin Account" });
  const loginButton = page.getByRole("button", { name: "Login" });

  if (await signupButton.isVisible().catch(() => false)) {
    await page.getByLabel("Name").fill(credentials.name);
    await page.getByLabel("Email").fill(credentials.email);
    await page.getByLabel("Password").fill(credentials.password);
    await signupButton.click();
    await page.waitForURL(
      (url) =>
        url.origin === origin && url.pathname === "/vivd-studio",
      { timeout: timeoutMs },
    );
  } else if (await loginButton.isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(credentials.email);
    await page.getByLabel("Password").fill(credentials.password);
    await loginButton.click();
    await page.waitForURL(
      (url) =>
        url.origin === origin && url.pathname === "/vivd-studio",
      { timeout: timeoutMs },
    );
  }
}

async function createScratchProject(page, timeoutMs) {
  const title = `Smoke ${randomUUID().slice(0, 8)}`;
  const description =
    "Create a polished one-page marketing site. Move fast and keep the first iteration concise.";

  await page.goto(`${DEFAULT_CONTROL_PLANE_ORIGIN}/vivd-studio/projects/new/scratch`, {
    waitUntil: "domcontentloaded",
  });

  await expectVisible(
    page.getByRole("heading", { name: "What should we build?" }),
    timeoutMs,
    "scratch wizard",
  );

  await page.getByPlaceholder("Acme Studio").fill(title);
  await page
    .getByPlaceholder("Describe the website you want to create.")
    .fill(description);

  const submitStartedAt = Date.now();
  await page.locator("form button[type='submit']").click();

  await page.waitForURL(
    /\/vivd-studio\/projects\/[^?]+\?view=studio.*initialGeneration=1/,
    { timeout: timeoutMs },
  );

  const redirectedAt = Date.now();
  const projectUrl = new URL(page.url());
  const projectSlug = projectUrl.pathname.split("/").filter(Boolean).pop();
  assert(projectSlug, "Expected redirected project slug in URL");

  return {
    projectSlug,
    handoffMs: redirectedAt - submitStartedAt,
  };
}

async function waitForStudioReady(page, timeoutMs) {
  await expectVisible(
    page.locator("iframe[title^='Vivd Studio -']"),
    timeoutMs,
    "studio iframe",
  );

  const frame = page.frameLocator("iframe[title^='Vivd Studio -']");

  await expectVisible(
    frame.getByRole("button", { name: "New session" }),
    timeoutMs,
    "studio toolbar",
  );
  await expectVisible(frame.locator("textarea").first(), timeoutMs, "chat composer");

  return frame;
}

async function stopInitialGeneration(frame, timeoutMs) {
  const stopButton = frame.getByRole("button", { name: "Stop generation" });
  await expectVisible(stopButton, timeoutMs, "stop generation button");
  await sleep(5_000);
  await stopButton.click();
  await expectVisible(
    frame.getByRole("button", { name: "Send message" }),
    timeoutMs,
    "send button after stop",
  );
}

function collectKnownBadMessages(messages) {
  return messages.filter((entry) =>
    KNOWN_BAD_CONSOLE_PATTERNS.some((pattern) => pattern.test(entry.text)),
  );
}

async function main() {
  const baseEnv = loadLocalEnv(process.env);
  const timeoutMs = readPositiveIntEnv(
    "VIVD_STUDIO_HOST_SMOKE_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    baseEnv,
  );
  const studioImage =
    getOptionalEnv("STUDIO_IMAGE", baseEnv) ||
    getOptionalEnv("DOCKER_STUDIO_IMAGE", baseEnv) ||
    DEFAULT_STUDIO_IMAGE;
  const modelOverride =
    getOptionalEnv("VIVD_STUDIO_HOST_SMOKE_MODEL", baseEnv) ||
    getOptionalEnv("OPENCODE_MODEL_STANDARD", baseEnv) ||
    DEFAULT_CHEAP_OPENROUTER_MODEL;

  if (!getOptionalEnv("OPENROUTER_API_KEY", baseEnv) && modelOverride.startsWith("openrouter/")) {
    throw new Error(
      "Studio host smoke requires OPENROUTER_API_KEY when using an OpenRouter model.",
    );
  }

  const pausedPort80Containers = await acquirePort80(baseEnv);

  const composeProject = `vivd-host-smoke-${randomUUID().slice(0, 8)}`;
  const workDir = process.cwd();
  const artifactDir = mkdtempSync(
    path.join(os.tmpdir(), "vivd-studio-host-smoke-"),
  );
  const screenshotPath = path.join(artifactDir, "failure.png");
  const metricsPath = path.join(artifactDir, "metrics.json");
  const smokeEnv = {
    ...baseEnv,
    POSTGRES_USER: getOptionalEnv("POSTGRES_USER", baseEnv) || "postgres",
    POSTGRES_PASSWORD:
      getOptionalEnv("POSTGRES_PASSWORD", baseEnv) || "password",
    POSTGRES_DB: getOptionalEnv("POSTGRES_DB", baseEnv) || "vivd_host_smoke",
    BETTER_AUTH_SECRET:
      getOptionalEnv("BETTER_AUTH_SECRET", baseEnv) ||
      "vivd-host-smoke-secret",
    SCRAPER_API_KEY:
      getOptionalEnv("SCRAPER_API_KEY", baseEnv) || "vivd-host-smoke-scraper",
    DOMAIN: DEFAULT_CONTROL_PLANE_ORIGIN,
    VIVD_INSTALL_PROFILE: "platform",
    TENANT_DOMAIN_ROUTING_ENABLED: "true",
    TENANT_BASE_DOMAIN: "localhost",
    CONTROL_PLANE_HOST: "app.localhost",
    SUPERADMIN_HOSTS: "app.localhost,default.localhost",
    TRUSTED_DOMAINS: "app.localhost,default.localhost",
    VIVD_DOCS_HOST: "docs.localhost",
    VIVD_DOCS_SITE_URL: "http://docs.localhost",
    VIVD_EMAIL_PROVIDER: getOptionalEnv("VIVD_EMAIL_PROVIDER", baseEnv) || "noop",
    VIVD_AUTH_EMAIL_VERIFICATION_SEND_ON_SIGNUP: "false",
    VIVD_AUTH_EMAIL_VERIFICATION_SEND_ON_SIGNIN: "false",
    VIVD_AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    VIVD_SCRATCH_CREATION_MODE: "studio_astro",
    STUDIO_MACHINE_PROVIDER: "docker",
    DOCKER_STUDIO_IMAGE: studioImage,
    DOCKER_STUDIO_NETWORK: `${composeProject}_vivd-network`,
    DOCKER_STUDIO_PUBLIC_BASE_URL: DEFAULT_CONTROL_PLANE_ORIGIN,
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
  const metrics = {};
  let succeeded = false;

  try {
    log(`Using Studio image ${studioImage}`);
    log(`Using default smoke model ${modelOverride}`);
    log(`Artifacts: ${artifactDir}`);

    runDockerCompose(
      composeProject,
      ["up", "--detach", "--build", "--remove-orphans"],
      { cwd: workDir, env: smokeEnv },
    );

    await waitForHealth("http://127.0.0.1/health", timeoutMs);
    await waitForHealth(
      `${DEFAULT_CONTROL_PLANE_ORIGIN}/vivd-studio/api/health`,
      timeoutMs,
    );

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    currentPage = page;

    page.on("console", (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
      });
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });

    const authStartedAt = Date.now();
    await authenticateOnHost(page, DEFAULT_CONTROL_PLANE_ORIGIN, credentials, timeoutMs);
    metrics.controlPlaneAuthMs = Date.now() - authStartedAt;

    const scratch = await createScratchProject(page, timeoutMs);
    createdProjectSlug = scratch.projectSlug;
    metrics.scratchHandoffMs = scratch.handoffMs;

    const studioReadyStartedAt = Date.now();
    const controlPlaneFrame = await waitForStudioReady(page, timeoutMs);
    metrics.controlPlaneStudioReadyMs = Date.now() - studioReadyStartedAt;

    await stopInitialGeneration(controlPlaneFrame, timeoutMs);
    await controlPlaneFrame.locator("textarea").first().fill(
      "Smoke follow-up draft only. Do not send.",
    );
    const sendButton = controlPlaneFrame.getByRole("button", {
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
    tenantPage.on("pageerror", (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });

    const tenantAuthStartedAt = Date.now();
    await authenticateOnHost(
      tenantPage,
      DEFAULT_TENANT_ORIGIN,
      credentials,
      timeoutMs,
    );
    metrics.tenantAuthMs = Date.now() - tenantAuthStartedAt;

    await tenantPage.goto(
      `${DEFAULT_TENANT_ORIGIN}/vivd-studio/projects/${createdProjectSlug}?view=studio&version=1`,
      { waitUntil: "domcontentloaded" },
    );
    const tenantReadyStartedAt = Date.now();
    await waitForStudioReady(tenantPage, timeoutMs);
    metrics.tenantStudioReadyMs = Date.now() - tenantReadyStartedAt;

    const badConsoleMessages = collectKnownBadMessages(consoleMessages);
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

    writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
    log(`Metrics:\n${JSON.stringify(metrics, null, 2)}`);
    log(`Smoke passed for ${createdProjectSlug}`);
    succeeded = true;
  } finally {
    if (!succeeded) {
      if (currentPage) {
        try {
          await currentPage.screenshot({ path: screenshotPath, fullPage: true });
          log(`Saved failure screenshot to ${screenshotPath}`);
        } catch (error) {
          log(`Could not capture failure screenshot: ${String(error)}`);
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
          ["logs", "--tail", "200"],
          { cwd: workDir, env: smokeEnv, allowFailure: true },
        );
        const combinedLogs = `${composeLogs.stdout}${composeLogs.stderr}`.trim();
        if (combinedLogs) {
          console.error(combinedLogs);
        }
      } catch {
        // Best effort.
      }
    }

    if (browser) {
      await browser.close().catch(() => undefined);
    }

    runDockerCompose(
      composeProject,
      ["down", "--volumes", "--remove-orphans"],
      { cwd: workDir, env: smokeEnv, allowFailure: true },
    );

    if (pausedPort80Containers.length > 0) {
      restartContainers(pausedPort80Containers);
    }

    if (succeeded) {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[studio-docker-host-smoke] ${message}`);
  process.exitCode = 1;
});
