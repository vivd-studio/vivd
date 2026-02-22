import { spawn, type ChildProcess, execSync, spawnSync } from "node:child_process";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import os from "node:os";
import * as path from "node:path";
import fs from "node:fs";
import treeKill from "tree-kill";
import { buildStudioOpencodeConfigContent } from "./configPolicy.js";
import {
  buildStudioOpencodeToolSource,
  getStudioOpencodeToolDefinitions,
  resolveStudioOpencodeToolPolicy,
} from "./toolRegistry.js";

const hasPsCommand = (() => {
  try {
    const result = spawnSync("ps", ["--version"], { stdio: "ignore" });
    return result.error === undefined;
  } catch {
    return false;
  }
})();

const hasOpencodeCommand = (() => {
  try {
    const result = spawnSync("opencode", ["--version"], { stdio: "ignore" });
    return result.error === undefined;
  } catch {
    return false;
  }
})();

interface OpencodeServerInfo {
  url: string;
  process: ChildProcess;
  port: number;
  lastActivity: number;
  directory: string;
}

const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const IDLE_TIMEOUT_MS = (() => {
  const raw = (process.env.OPENCODE_IDLE_TIMEOUT_MS || "").trim();
  if (!raw) return DEFAULT_IDLE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_TIMEOUT_MS;
  return parsed;
})();
const MAX_SERVERS = 10;
const debugEnabled = process.env.OPENCODE_DEBUG === "true";
const debugLog = (...args: unknown[]) => {
  if (debugEnabled) {
    console.log("[OpenCode ServerManager]", ...args);
  }
};

function resolveOpencodeConfigDir(): string {
  const xdgConfigHome = (process.env.XDG_CONFIG_HOME || "").trim();
  if (xdgConfigHome) return path.join(xdgConfigHome, "opencode");
  return path.join(os.homedir(), ".config", "opencode");
}

function resolveOpencodeToolsDir(): string {
  return path.join(resolveOpencodeConfigDir(), "tools");
}

async function ensureFileContents(filePath: string, contents: string): Promise<void> {
  try {
    const existing = await fs.promises.readFile(filePath, "utf-8");
    if (existing === contents) return;
  } catch {
    // Ignore and write below.
  }

  await fs.promises.writeFile(filePath, contents, "utf-8");
}

let ensureVivdOpencodeToolsPromise: Promise<void> | null = null;
async function ensureVivdOpencodeToolsInstalled(): Promise<void> {
  if (ensureVivdOpencodeToolsPromise) return ensureVivdOpencodeToolsPromise;

  ensureVivdOpencodeToolsPromise = (async () => {
    const toolsDir = resolveOpencodeToolsDir();
    await fs.promises.mkdir(toolsDir, { recursive: true });
    const expectedFiles = new Set<string>();
    for (const definition of getStudioOpencodeToolDefinitions()) {
      expectedFiles.add(definition.sourceFile);
      const source = buildStudioOpencodeToolSource(definition, process.env);
      await ensureFileContents(
        path.join(toolsDir, definition.sourceFile),
        source,
      );
    }

    const legacyManagedFiles = new Set([
      "vivd_plugins_contact_ensure.ts",
      "vivd_plugins_contact_snippet.ts",
    ]);
    const entries = await fs.promises.readdir(toolsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts")) continue;
      if (!entry.name.startsWith("vivd_")) continue;

      if (expectedFiles.has(entry.name)) continue;
      if (!legacyManagedFiles.has(entry.name)) continue;

      await fs.promises.rm(path.join(toolsDir, entry.name), { force: true });
    }
  })().catch((error) => {
    ensureVivdOpencodeToolsPromise = null;
    throw error;
  });

  return ensureVivdOpencodeToolsPromise;
}

class OpencodeServerManager {
  private servers = new Map<string, OpencodeServerInfo>();
  private startingServers = new Map<string, Promise<OpencodeServerInfo>>();
  private nextPort = Math.max(
    1024,
    Number.parseInt(process.env.OPENCODE_PORT_START || "4096", 10) || 4096
  );
  private availablePorts: number[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    if (process.env.OPENCODE_KILL_ORPHANS !== "0") {
      this.killOrphanedProcesses();
    }
    if (IDLE_TIMEOUT_MS > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupIdleServers();
      }, 60 * 1000);
      this.cleanupInterval.unref?.();
    }
  }

  private killOrphanedProcesses(): void {
    const patterns = ["opencode serve", "opencode run.*language"];

    for (const pattern of patterns) {
      try {
        const result = execSync(`pgrep -f "${pattern}" 2>/dev/null || true`, {
          encoding: "utf-8",
        });
        const pids = result
          .trim()
          .split("\n")
          .filter((p) => p);

        if (pids.length > 0) {
          console.log(
            `[OpenCode] Killing ${pids.length} orphaned "${pattern}" process(es)...`,
          );
          for (const pid of pids) {
            const numPid = parseInt(pid, 10);
            try {
              process.kill(numPid, "SIGTERM");
            } catch {
              // ignore
            }
          }

          setTimeout(() => {
            for (const pid of pids) {
              try {
                process.kill(parseInt(pid, 10), "SIGKILL");
              } catch {
                // ignore
              }
            }
          }, 1000);
        }
      } catch (e) {
        debugLog("Could not check for orphaned processes:", e);
      }
    }
  }

  private killProcessTree(pid: number): Promise<void> {
    if (!hasPsCommand) {
      return this.simpleKill(pid);
    }

    return new Promise((resolve) => {
      treeKill(pid, "SIGTERM", (err) => {
        if (err) {
          resolve();
          return;
        }

        setTimeout(() => {
          try {
            process.kill(pid, 0);
            treeKill(pid, "SIGKILL", () => resolve());
          } catch {
            resolve();
          }
        }, 1000);
      });
    });
  }

  private simpleKill(pid: number): Promise<void> {
    return new Promise((resolve) => {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          resolve();
          return;
        }
      }

      setTimeout(() => {
        try {
          process.kill(-pid, 0);
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, 0);
            process.kill(pid, "SIGKILL");
          } catch {
            // ignore
          }
        }
        resolve();
      }, 1000);
    });
  }

  private getPort(): number {
    if (this.availablePorts.length > 0) {
      return this.availablePorts.pop()!;
    }
    return this.nextPort++;
  }

  private releasePort(port: number): void {
    if (!this.availablePorts.includes(port)) {
      this.availablePorts.push(port);
    }
  }

  async getOrCreateServerInfo(projectDir: string): Promise<OpencodeServerInfo> {
    const dirKey = this.normalizeProjectDir(projectDir);

    const existing = this.servers.get(dirKey);
    if (existing) {
      existing.lastActivity = Date.now();
      debugLog(`Reusing existing server for ${dirKey}`);
      return existing;
    }

    const starting = this.startingServers.get(dirKey);
    if (starting) {
      const server = await starting;
      server.lastActivity = Date.now();
      debugLog(`Awaited starting server for ${dirKey}`);
      return server;
    }

    if (this.servers.size >= MAX_SERVERS) {
      console.log(
        `[OpenCode] At max server limit (${MAX_SERVERS}), stopping oldest idle server...`,
      );
      await this.stopOldestIdleServer();
    }

    const port = this.getPort();
    console.log(
      `[OpenCode] Spawning server for ${dirKey} on port ${port} (${this.servers.size + 1}/${MAX_SERVERS})`,
    );

    const startPromise = this.spawnServer(dirKey, port)
      .then((server) => {
        this.servers.set(dirKey, server);
        return server;
      })
      .catch((error) => {
        this.releasePort(port);
        throw error;
      })
      .finally(() => {
        this.startingServers.delete(dirKey);
      });

    this.startingServers.set(dirKey, startPromise);

    const server = await startPromise;
    return server;
  }

  async getClientAndDirectory(
    projectDir: string,
  ): Promise<{ client: OpencodeClient; directory: string }> {
    const server = await this.getOrCreateServerInfo(projectDir);
    return {
      client: createOpencodeClient({
        baseUrl: server.url,
        directory: server.directory,
      }),
      directory: server.directory,
    };
  }

  async getClient(projectDir: string): Promise<OpencodeClient> {
    return (await this.getClientAndDirectory(projectDir)).client;
  }

  touchProject(projectDir: string): void {
    const server = this.servers.get(this.normalizeProjectDir(projectDir));
    if (server) {
      server.lastActivity = Date.now();
    }
  }

  async stopServer(projectDir: string): Promise<boolean> {
    const dirKey = this.normalizeProjectDir(projectDir);
    const server = this.servers.get(dirKey);

    if (!server) {
      debugLog(`No server to stop for ${dirKey}`);
      return false;
    }

    console.log(`[OpenCode] Stopping server for ${dirKey} (port ${server.port})`);
    await this.killProcessTree(server.process.pid!);
    this.releasePort(server.port);
    this.servers.delete(dirKey);

    return true;
  }

  async stopByProjectPrefix(projectPrefix: string): Promise<number> {
    const normalizedPrefix = this.normalizeProjectDir(projectPrefix);
    const toStop = Array.from(this.servers.keys()).filter((key) =>
      key.startsWith(normalizedPrefix),
    );

    for (const dirKey of toStop) {
      const server = this.servers.get(dirKey);
      if (!server) continue;
      await this.killProcessTree(server.process.pid!);
      this.releasePort(server.port);
      this.servers.delete(dirKey);
    }

    return toStop.length;
  }

  closeAll(): void {
    console.log("[OpenCode] Closing all servers...");
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const server of this.servers.values()) {
      try {
        this.killProcessTree(server.process.pid!);
      } catch {
        // ignore
      }
    }
    this.servers.clear();
    this.startingServers.clear();
  }

  private normalizeProjectDir(projectDir: string): string {
    return path.resolve(projectDir);
  }

  private async waitForServerReady(
    url: string,
    proc: ChildProcess,
    timeoutMs = 20_000,
  ): Promise<void> {
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (proc.exitCode !== null) {
        throw new Error(
          `[OpenCode] Server exited before ready (code=${proc.exitCode})`,
        );
      }

      attempt += 1;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1_000);

        const response = await fetch(`${url}/config`, {
          method: "GET",
          signal: controller.signal,
        });

        clearTimeout(timeout);
        // We don't care about the payload — any HTTP response means the server is accepting requests.
        void response.body?.cancel?.();
        return;
      } catch {
        // Ignore and retry.
      }

      const backoffMs = Math.min(1_000, 150 + attempt * 100);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    throw new Error(`[OpenCode] Timed out waiting for server to be ready at ${url}`);
  }

  private async spawnServer(
    projectDir: string,
    port: number,
  ): Promise<OpencodeServerInfo> {
    if (!hasOpencodeCommand) {
      throw new Error(
        `[OpenCode] Cannot start server because "opencode" was not found in PATH. Install opencode-ai or rebuild the runtime image so the "opencode" CLI is available.`,
      );
    }

    const workspaceDir = this.normalizeProjectDir(projectDir);

    const url = `http://127.0.0.1:${port}`;
    const toolPolicy = resolveStudioOpencodeToolPolicy(process.env);
    const opencodeConfigContent = buildStudioOpencodeConfigContent(
      process.env.OPENCODE_CONFIG_CONTENT,
      {
        toolEnablement: toolPolicy.enabledByName,
      },
    );

    try {
      await ensureVivdOpencodeToolsInstalled();
    } catch (error) {
      console.error("[OpenCode] Failed to install Vivd OpenCode tools:", error);
    }

    const proc = spawn("opencode", ["serve", "--port", String(port)], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        OPENCODE_PROJECT_DIR: workspaceDir,
        OPENCODE_CONFIG_CONTENT: opencodeConfigContent,
      },
      stdio: debugEnabled ? "inherit" : "ignore",
      detached: true,
    });

    proc.on("error", (error) => {
      console.error("[OpenCode] opencode process error:", error);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        proc.off("spawn", onSpawn);
        reject(error);
      };
      const onSpawn = () => {
        proc.off("error", onError);
        resolve();
      };

      proc.once("spawn", onSpawn);
      proc.once("error", onError);
    });

    proc.unref();

    try {
      await this.waitForServerReady(url, proc);
    } catch (error) {
      try {
        await this.killProcessTree(proc.pid!);
      } catch {
        // ignore
      }
      throw error;
    }

    return {
      url,
      process: proc,
      port,
      lastActivity: Date.now(),
      directory: workspaceDir,
    };
  }

  private cleanupIdleServers(): void {
    const now = Date.now();
    for (const [dirKey, server] of this.servers.entries()) {
      const idleTime = now - server.lastActivity;
      if (idleTime > IDLE_TIMEOUT_MS) {
        console.log(
          `[OpenCode] Cleaning up idle server for ${dirKey} (idle ${Math.round(
            idleTime / 1000,
          )}s)`,
        );
        this.stopServer(dirKey);
      }
    }
  }

  private async stopOldestIdleServer(): Promise<void> {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [dirKey, server] of this.servers.entries()) {
      if (server.lastActivity < oldestTime) {
        oldestTime = server.lastActivity;
        oldestKey = dirKey;
      }
    }

    if (oldestKey) {
      await this.stopServer(oldestKey);
    }
  }
}

export const serverManager = new OpencodeServerManager();
