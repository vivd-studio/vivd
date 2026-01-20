import { spawn, ChildProcess } from "node:child_process";
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk";

interface OpencodeServerInfo {
  url: string;
  process: ChildProcess;
  port: number;
  lastActivity: number;
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
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
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleServers();
    }, 60 * 1000); // Check every minute
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

    const port = this.nextPort++;
    console.log(`[OpenCode] Spawning server for ${dirKey} on port ${port}`);

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
    return projectDir.replace(/[\\/]+$/, "");
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

  private cleanupIdleServers(): void {
    const now = Date.now();
    for (const [dir, server] of this.servers.entries()) {
      if (now - server.lastActivity > IDLE_TIMEOUT_MS) {
        console.log(`[OpenCode] Stopping idle server for ${dir}`);
        try {
          server.process.kill();
        } catch (e) {
          // ignore
        }
        this.servers.delete(dir);
      }
    }
  }

  /**
   * Close all servers gracefully.
   */
  closeAll(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log(`[OpenCode] Stopping ${this.servers.size} server(s)...`);
    for (const [dir, server] of this.servers.entries()) {
      console.log(`[OpenCode] Stopping server for ${dir}`);
      try {
        server.process.kill();
      } catch (e) {
        // ignore
      }
    }
    this.servers.clear();
  }

  /**
   * Check if a server exists for a directory.
   */
  hasServer(projectDir: string): boolean {
    return this.servers.has(this.normalizeProjectDir(projectDir));
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
