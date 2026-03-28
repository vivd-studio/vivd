#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_IMAGE = "vivd-server:release-smoke";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POSTGRES_IMAGE = "postgres:16-alpine";

function log(message) {
  console.log(`[backend-image-smoke] ${message}`);
}

function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getSmokeTimeoutMs() {
  const raw = getOptionalEnv("VIVD_BACKEND_SMOKE_TIMEOUT_MS");
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 30_000) {
    throw new Error(
      "VIVD_BACKEND_SMOKE_TIMEOUT_MS must be an integer >= 30000",
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

async function waitForPostgresReady(containerId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = runDocker(
      ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "vivd_smoke"],
      { allowFailure: true },
    );

    if (result.status === 0) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for Postgres container ${containerId}`);
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
    `Backend container stopped during ${phase}.${logs ? ` Logs:\n${logs}` : ""}`,
  );
}

async function waitForHealth(baseUrl, containerId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    assertContainerRunning(containerId, "startup");

    try {
      const response = await fetch(`${baseUrl}/vivd-studio/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ok") {
          return body;
        }
      }
    } catch {
      // Retry.
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for backend health at ${baseUrl}/vivd-studio/api/health`,
  );
}

function assertSchemaInitialized(postgresContainerId) {
  const result = runDocker([
    "exec",
    postgresContainerId,
    "psql",
    "-U",
    "postgres",
    "-d",
    "vivd_smoke",
    "-Atc",
    [
      "select table_name",
      "from information_schema.tables",
      "where table_schema = 'public'",
      "order by table_name;",
    ].join(" "),
  ]);

  const tables = new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const expectedTables = [
    "organization",
    "user",
    "session",
    "system_setting",
    "project_meta",
    "project_version",
    "project_publish_checklist",
    "project_plugin_instance",
  ];
  const missing = expectedTables.filter((table) => !tables.has(table));

  assert.equal(
    missing.length,
    0,
    [
      "Expected backend startup migrations to initialize the core schema.",
      `Missing tables: ${missing.join(", ") || "none"}`,
      `Present tables: ${Array.from(tables).join(", ") || "none"}`,
    ].join("\n"),
  );
}

async function main() {
  const image = getOptionalEnv("BACKEND_IMAGE") || DEFAULT_IMAGE;
  const postgresImage =
    getOptionalEnv("VIVD_BACKEND_SMOKE_POSTGRES_IMAGE") || DEFAULT_POSTGRES_IMAGE;
  const timeoutMs = getSmokeTimeoutMs();
  const backendPort = await getFreePort();
  const backendContainer = `vivd-backend-smoke-${randomUUID().slice(0, 12)}`;
  const postgresContainer = `vivd-backend-smoke-pg-${randomUUID().slice(0, 12)}`;
  const dockerNetwork = `vivd-backend-smoke-net-${randomUUID().slice(0, 12)}`;
  const baseUrl = `http://127.0.0.1:${backendPort}`;
  const databaseUrl = `postgresql://postgres:password@${postgresContainer}:5432/vivd_smoke`;

  log(`Using backend image ${image}`);
  log(`Using postgres image ${postgresImage}`);

  let createdNetwork = false;
  let startedPostgres = false;
  let startedBackend = false;
  let succeeded = false;

  try {
    runDocker(["network", "create", dockerNetwork]);
    createdNetwork = true;

    const postgresRun = runDocker([
      "run",
      "--detach",
      "--name",
      postgresContainer,
      "--network",
      dockerNetwork,
      "--env",
      "POSTGRES_USER=postgres",
      "--env",
      "POSTGRES_PASSWORD=password",
      "--env",
      "POSTGRES_DB=vivd_smoke",
      postgresImage,
    ]);
    if (!postgresRun.stdout.trim()) {
      throw new Error("docker run did not return a postgres container id");
    }
    startedPostgres = true;

    await waitForPostgresReady(postgresContainer, timeoutMs);

    const backendRun = runDocker([
      "run",
      "--detach",
      "--name",
      backendContainer,
      "--network",
      dockerNetwork,
      "--publish",
      `127.0.0.1:${backendPort}:3000`,
      "--env",
      "PORT=3000",
      "--env",
      `DATABASE_URL=${databaseUrl}`,
      "--env",
      "BETTER_AUTH_SECRET=backend-image-smoke-secret",
      "--env",
      "DOMAIN=http://localhost",
      "--env",
      "SCRAPER_API_KEY=backend-image-smoke-scraper-key",
      "--env",
      "VIVD_SELFHOST_CADDY_UI_MANAGED=false",
      "--env",
      "VIVD_EMAIL_PROVIDER=noop",
      image,
    ]);
    if (!backendRun.stdout.trim()) {
      throw new Error("docker run did not return a backend container id");
    }
    startedBackend = true;

    await waitForHealth(baseUrl, backendContainer, timeoutMs);
    assertSchemaInitialized(postgresContainer);
    succeeded = true;
    log("Backend image smoke test completed successfully");
  } finally {
    if (startedBackend) {
      const logs = !succeeded ? getContainerLogs(backendContainer) : "";
      if (logs) {
        log("Backend container logs:");
        process.stdout.write(`${logs}\n`);
      }
      runDocker(["rm", "-f", backendContainer], { allowFailure: true });
    }

    if (startedPostgres) {
      const logs = !succeeded ? getContainerLogs(postgresContainer) : "";
      if (logs) {
        log("Postgres container logs:");
        process.stdout.write(`${logs}\n`);
      }
      runDocker(["rm", "-f", postgresContainer], { allowFailure: true });
    }

    if (createdNetwork) {
      runDocker(["network", "rm", dockerNetwork], { allowFailure: true });
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[backend-image-smoke] ${message}`);
  process.exit(1);
});
