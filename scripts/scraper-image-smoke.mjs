#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_IMAGE = "vivd-scraper:release-smoke";
const DEFAULT_TIMEOUT_MS = 120_000;

function log(message) {
  console.log(`[scraper-image-smoke] ${message}`);
}

function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getSmokeTimeoutMs() {
  const raw = getOptionalEnv("VIVD_SCRAPER_SMOKE_TIMEOUT_MS");
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 30_000) {
    throw new Error(
      "VIVD_SCRAPER_SMOKE_TIMEOUT_MS must be an integer >= 30000",
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
    `Scraper container stopped during ${phase}.${logs ? ` Logs:\n${logs}` : ""}`,
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
        if (body?.status === "ok") {
          return body;
        }
      }
    } catch {
      // Retry.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for scraper health at ${baseUrl}/health`);
}

async function main() {
  const image = getOptionalEnv("SCRAPER_IMAGE") || DEFAULT_IMAGE;
  const timeoutMs = getSmokeTimeoutMs();
  const scraperPort = await getFreePort();
  const containerName = `vivd-scraper-smoke-${randomUUID().slice(0, 12)}`;
  const baseUrl = `http://127.0.0.1:${scraperPort}`;
  let succeeded = false;

  log(`Using image ${image}`);

  let started = false;
  try {
    const run = runDocker([
      "run",
      "--detach",
      "--name",
      containerName,
      "--publish",
      `127.0.0.1:${scraperPort}:3001`,
      "--env",
      "SCRAPER_API_KEY=scraper-image-smoke-key",
      image,
    ]);
    if (!run.stdout.trim()) {
      throw new Error("docker run did not return a scraper container id");
    }
    started = true;

    const body = await waitForHealth(baseUrl, containerName, timeoutMs);
    assert.equal(body?.status, "ok", "Expected scraper /health status=ok");
    succeeded = true;
    log("Scraper image smoke test completed successfully");
  } finally {
    if (started) {
      const logs = !succeeded ? getContainerLogs(containerName) : "";
      if (logs) {
        log("Scraper container logs:");
        process.stdout.write(`${logs}\n`);
      }
      runDocker(["rm", "-f", containerName], { allowFailure: true });
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[scraper-image-smoke] ${message}`);
  process.exit(1);
});
