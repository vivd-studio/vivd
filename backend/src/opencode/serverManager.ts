import { spawn, ChildProcess, execSync } from "node:child_process";
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk";
import * as path from "node:path";
import treeKill from "tree-kill";

interface OpencodeServerInfo {
  url: string;
  process: ChildProcess;
  port: number;
  lastActivity: number;
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SERVERS = 10; // Maximum concurrent opencode servers
const debugEnabled = process.env.OPENCODE_DEBUG === "true";
const debugLog = (...args: unknown[]) => {
  if (debugEnabled) {
    console.log("[ServerManager]", ...args);
  }
};

/**
 * Manages opencode server instances per project directory.
 * Each project gets its own server spawned with the correct cwd,
 * ensuring proper directory isolation for permissions.
 */
class OpencodeServerManager {
  private servers = new Map<string, OpencodeServerInfo>();
  private startingServers = new Map<string, Promise<OpencodeServerInfo>>();
  private nextPort = 4096;
  private availablePorts: number[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Kill any orphaned opencode serve processes from previous runs
    this.killOrphanedProcesses();

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleServers();
    }, 60 * 1000); // Check every minute
  }

  /**
   * Kill any orphaned opencode serve processes from previous server runs.
   * This handles the case where the backend restarts but child processes survive.
   * Also kills language server children that may have survived parent death.
   */
  private killOrphanedProcesses(): void {
    const patterns = [
      "opencode serve", // Main servers
      "opencode run.*language", // Language servers (astro, etc)
    ];

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
              // Process may have already exited
            }
          }

          // Wait 1 second then SIGKILL any survivors
          setTimeout(() => {
            for (const pid of pids) {
              try {
                process.kill(parseInt(pid, 10), "SIGKILL");
              } catch {
                // Process may have already exited
              }
            }
          }, 1000);
        }
      } catch (e) {
        // pgrep not available or failed - that's fine
        debugLog("Could not check for orphaned processes:", e);
      }
    }
  }

  /**
   * Kill a process and all its children using tree-kill.
   * First tries SIGTERM for graceful shutdown, then SIGKILL after 1 second.
   */
  private killProcessTree(pid: number): Promise<void> {
    return new Promise((resolve) => {
      // First try SIGTERM for graceful shutdown
      treeKill(pid, "SIGTERM", (err) => {
        if (err) {
          resolve(); // Process already dead
          return;
        }

        // Wait 1 second, then force kill if still alive
        setTimeout(() => {
          try {
            process.kill(pid, 0); // Check if alive (throws if dead)
            treeKill(pid, "SIGKILL", () => resolve());
          } catch {
            resolve(); // Already dead
          }
        }, 1000);
      });
    });
  }

  /**
   * Get an available port, recycling freed ports when possible.
   */
  private getPort(): number {
    if (this.availablePorts.length > 0) {
      return this.availablePorts.pop()!;
    }
    return this.nextPort++;
  }

  /**
   * Release a port back to the pool for reuse.
   */
  private releasePort(port: number): void {
    if (!this.availablePorts.includes(port)) {
      this.availablePorts.push(port);
    }
  }

  /**
   * Get or create an opencode server for a project directory.
   * Returns the server URL.
   */
  async getOrCreateServer(projectDir: string): Promise<string> {
    const dirKey = this.normalizeProjectDir(projectDir);

    const existing = this.servers.get(dirKey);
    if (existing) {
      existing.lastActivity = Date.now();
      debugLog(`Reusing existing server for ${dirKey}`);
      return existing.url;
    }

    const starting = this.startingServers.get(dirKey);
    if (starting) {
      const server = await starting;
      server.lastActivity = Date.now();
      debugLog(`Awaited starting server for ${dirKey}`);
      return server.url;
    }

    // Enforce maximum server limit - clean up oldest idle server if at limit
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
      .finally(() => {
        this.startingServers.delete(dirKey);
      });

    this.startingServers.set(dirKey, startPromise);

    const server = await startPromise;
    return server.url;
  }

  /**
   * Get a client for a specific project directory.
   * Automatically creates or reuses the server.
   */
  async getClient(projectDir: string): Promise<OpencodeClient> {
    const serverUrl = await this.getOrCreateServer(projectDir);
    return createOpencodeClient({
      baseUrl: serverUrl,
      directory: this.normalizeProjectDir(projectDir),
    });
  }

  /**
   * Update last activity time for a project to prevent idle cleanup.
   */
  touchProject(projectDir: string): void {
    const server = this.servers.get(this.normalizeProjectDir(projectDir));
    if (server) {
      server.lastActivity = Date.now();
    }
  }

  private normalizeProjectDir(projectDir: string): string {
    // Use path.resolve for canonical absolute path, then remove trailing slashes
    return path.resolve(projectDir).replace(/[\\/]+$/, "");
  }

  private async spawnServer(
    cwd: string,
    port: number,
  ): Promise<OpencodeServerInfo> {
    const hostname = "127.0.0.1";
    const timeout = 10000; // 10 seconds

    const config = {
      model: process.env.OPENCODE_MODEL,
      username: "Website Agent",
      permission: {
        external_directory: "deny",
        doom_loop: "deny",
        question: "deny",
        task: "deny",
      },
    };

    const args = [`serve`, `--hostname=${hostname}`, `--port=${port}`];

    const proc = spawn(`opencode`, args, {
      cwd, // This is the key fix!
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
    });

    const url = await new Promise<string>((resolve, reject) => {
      const id = setTimeout(() => {
        proc.kill();
        reject(
          new Error(`Timeout waiting for server to start after ${timeout}ms`),
        );
      }, timeout);

      let output = "";

      proc.stdout?.on("data", (chunk) => {
        output += chunk.toString();
        const lines = output.split("\n");
        for (const line of lines) {
          if (line.startsWith("opencode server listening")) {
            const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
            if (!match) {
              clearTimeout(id);
              reject(
                new Error(`Failed to parse server url from output: ${line}`),
              );
              return;
            }
            clearTimeout(id);
            resolve(match[1]);
            return;
          }
        }
      });

      proc.stderr?.on("data", (chunk) => {
        output += chunk.toString();
        debugLog("stderr:", chunk.toString());
      });

      proc.on("exit", (code) => {
        clearTimeout(id);
        let msg = `Server exited with code ${code}`;
        if (output.trim()) {
          msg += `\nServer output: ${output}`;
        }
        reject(new Error(msg));
      });

      proc.on("error", (error) => {
        clearTimeout(id);
        reject(error);
      });
    });

    console.log(`[OpenCode] Server ready at ${url} for ${cwd}`);

    return {
      url,
      process: proc,
      port,
      lastActivity: Date.now(),
    };
  }

  private async cleanupIdleServers(): Promise<void> {
    const now = Date.now();
    const killPromises: Promise<void>[] = [];

    for (const [dir, server] of this.servers.entries()) {
      if (now - server.lastActivity > IDLE_TIMEOUT_MS) {
        console.log(`[OpenCode] Stopping idle server for ${dir}`);
        this.servers.delete(dir);
        this.releasePort(server.port);
        if (server.process.pid) {
          killPromises.push(this.killProcessTree(server.process.pid));
        }
      }
    }

    await Promise.all(killPromises);
  }

  /**
   * Stop the oldest idle server to make room for a new one.
   * Called when we hit MAX_SERVERS limit.
   */
  private async stopOldestIdleServer(): Promise<void> {
    let oldestDir: string | null = null;
    let oldestActivity = Infinity;

    for (const [dir, server] of this.servers.entries()) {
      if (server.lastActivity < oldestActivity) {
        oldestActivity = server.lastActivity;
        oldestDir = dir;
      }
    }

    if (oldestDir) {
      const server = this.servers.get(oldestDir);
      if (server) {
        console.log(`[OpenCode] Evicting oldest server for ${oldestDir}`);
        this.servers.delete(oldestDir);
        this.releasePort(server.port);
        if (server.process.pid) {
          await this.killProcessTree(server.process.pid);
        }
      }
    }
  }

  /**
   * Close all servers gracefully.
   */
  async closeAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log(`[OpenCode] Stopping ${this.servers.size} server(s)...`);
    const killPromises: Promise<void>[] = [];

    for (const [dir, server] of this.servers.entries()) {
      console.log(`[OpenCode] Stopping server for ${dir}`);
      this.releasePort(server.port);
      if (server.process.pid) {
        killPromises.push(this.killProcessTree(server.process.pid));
      }
    }
    this.servers.clear();

    await Promise.all(killPromises);
  }

  /**
   * Check if a server exists for a directory.
   */
  hasServer(projectDir: string): boolean {
    return this.servers.has(this.normalizeProjectDir(projectDir));
  }

  /**
   * Stop all servers whose directory starts with the given prefix.
   * Used when deleting an entire project (stops all version servers).
   */
  async stopByProjectPrefix(projectDirPrefix: string): Promise<number> {
    const normalizedPrefix = this.normalizeProjectDir(projectDirPrefix);
    let stopped = 0;
    const killPromises: Promise<void>[] = [];

    for (const [dir, server] of this.servers.entries()) {
      if (dir.startsWith(normalizedPrefix)) {
        console.log(`[OpenCode] Stopping server for ${dir} (project deletion)`);
        this.servers.delete(dir);
        this.releasePort(server.port);
        if (server.process.pid) {
          killPromises.push(this.killProcessTree(server.process.pid));
        }
        stopped++;
      }
    }

    await Promise.all(killPromises);
    return stopped;
  }

  /**
   * Stop server for a specific directory.
   */
  async stopServer(projectDir: string): Promise<void> {
    const normalizedDir = this.normalizeProjectDir(projectDir);
    const server = this.servers.get(normalizedDir);
    if (server) {
      console.log(`[OpenCode] Stopping server for ${normalizedDir}`);
      this.servers.delete(normalizedDir);
      this.releasePort(server.port);
      if (server.process.pid) {
        await this.killProcessTree(server.process.pid);
      }
    }
  }

  /**
   * Get the number of active servers.
   */
  get serverCount(): number {
    return this.servers.size;
  }
}

// Singleton instance
export const serverManager = new OpencodeServerManager();
