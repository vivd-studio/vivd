import { spawn, ChildProcess, execSync } from "node:child_process";
import path from "path";
import {
  detectProjectType,
  hasNodeModules,
  type ProjectConfig,
} from "./projectType";

interface DevServerInfo {
  url: string;
  process: ChildProcess;
  port: number;
  projectDir: string;
  basePath: string;
  lastActivity: number;
  status: "installing" | "starting" | "ready" | "error";
  error?: string;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (shorter than opencode's 10 min)
const DEV_SERVER_PORT_START = 5100; // Avoid conflicts with common ports

const isDebugEnabled = process.env.DEVSERVER_DEBUG === "1";
const debugLog = (...args: unknown[]) => {
  if (!isDebugEnabled) return;
  console.log("[DevServer DEBUG]", ...args);
};

/**
 * Manages dev server instances for framework-based projects.
 * Each project version gets its own dev server spawned with proper port allocation.
 */
class DevServerManager {
  private servers = new Map<string, DevServerInfo>();
  private nextPort = DEV_SERVER_PORT_START;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleServers();
    }, 60 * 1000); // Check every minute
  }

  /**
   * Get project configuration (static vs dev server).
   */
  getProjectConfig(projectDir: string): ProjectConfig {
    return detectProjectType(projectDir);
  }

  /**
   * Get the status of a dev server for a project.
   */
  getDevServerStatus(
    projectDir: string
  ): "none" | "installing" | "starting" | "ready" | "error" {
    const server = this.servers.get(projectDir);
    if (!server) return "none";
    return server.status;
  }

  /**
   * Get dev server URL if ready.
   */
  getDevServerUrl(projectDir: string): string | null {
    const server = this.servers.get(projectDir);
    if (server?.status === "ready") {
      server.lastActivity = Date.now();
      return server.url;
    }
    return null;
  }

  /**
   * Start or get an existing dev server for a project.
   * Handles npm install if needed.
   * @param projectDir - The project directory path
   * @param basePath - The base path for the dev server (e.g., /vivd-studio/api/devpreview/slug/v1)
   */
  async getOrStartDevServer(
    projectDir: string,
    basePath: string = "/"
  ): Promise<{
    url: string | null;
    status: DevServerInfo["status"];
    error?: string;
  }> {
    const existing = this.servers.get(projectDir);
    if (existing) {
      existing.lastActivity = Date.now();
      return {
        url: existing.status === "ready" ? existing.url : null,
        status: existing.status,
        error: existing.error,
      };
    }

    const config = detectProjectType(projectDir);
    if (config.mode !== "devserver" || !config.devCommand) {
      return { url: null, status: "error", error: "Not a dev server project" };
    }

    const port = this.nextPort++;
    console.log(
      `[DevServer] Starting dev server for ${projectDir} on port ${port} with base ${basePath}`
    );

    // Create initial entry with installing status
    // Dev server listens on 0.0.0.0 but we connect via 127.0.0.1
    const serverInfo: DevServerInfo = {
      url: `http://127.0.0.1:${port}`,
      process: null as unknown as ChildProcess, // Will be set after spawn
      port,
      projectDir,
      basePath,
      lastActivity: Date.now(),
      status: hasNodeModules(projectDir) ? "starting" : "installing",
    };
    this.servers.set(projectDir, serverInfo);

    // Run npm install if needed (async)
    this.startServerAsync(projectDir, config, port, basePath, serverInfo);

    return { url: null, status: serverInfo.status };
  }

  private async startServerAsync(
    projectDir: string,
    config: ProjectConfig,
    port: number,
    basePath: string,
    serverInfo: DevServerInfo
  ): Promise<void> {
    try {
      // Install dependencies if needed
      if (!hasNodeModules(projectDir)) {
        console.log(`[DevServer] Installing dependencies in ${projectDir}`);
        serverInfo.status = "installing";

        const installCmd =
          config.packageManager === "pnpm"
            ? "pnpm install"
            : config.packageManager === "yarn"
            ? "yarn install"
            : "npm install";

        try {
          execSync(installCmd, {
            cwd: projectDir,
            stdio: "pipe",
            encoding: "utf-8",
            timeout: 5 * 60 * 1000, // 5 minute timeout for install
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[DevServer] Failed to install dependencies: ${msg}`);
          serverInfo.status = "error";
          serverInfo.error = `npm install failed: ${msg}`;
          return;
        }
      }

      serverInfo.status = "starting";

      // Start the dev server
      await this.spawnDevServer(projectDir, config, port, basePath, serverInfo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DevServer] Error starting dev server: ${msg}`);
      serverInfo.status = "error";
      serverInfo.error = msg;
    }
  }

  private async spawnDevServer(
    projectDir: string,
    config: ProjectConfig,
    port: number,
    basePath: string,
    serverInfo: DevServerInfo
  ): Promise<void> {
    // Use 0.0.0.0 for Docker - dev server must listen on all interfaces
    const hostname = "0.0.0.0";
    const timeout = 60000; // 60 seconds to start

    // Build command with port override
    // Different frameworks have different port flags
    const portEnv: Record<string, string> = {
      ...process.env,
      PORT: String(port), // Generic
      HOST: hostname,
    };

    const normalizedBasePath = basePath.startsWith("/") ? basePath : `/${basePath}`;
    const baseForCli = normalizedBasePath.endsWith("/")
      ? normalizedBasePath
      : `${normalizedBasePath}/`;

    let cmd: string;
    let args: string[];

    if (config.framework === "astro") {
      // Astro's `--base` is a global flag (shown under `astro --help`), so it must come
      // before the subcommand to apply reliably when spawning.
      cmd = path.join(projectDir, "node_modules", ".bin", "astro");
      args = [
        "--base",
        baseForCli,
        "dev",
        "--port",
        String(port),
        "--host",
        hostname,
      ];
    } else {
      // Parse the dev command
      const [rawCmd, ...baseArgs] = config.devCommand!.split(" ");
      cmd = rawCmd;

      // For npm/pnpm/yarn run commands, we need "--" to pass args to the underlying script
      // e.g., "npm run dev -- --port 5100 --host 0.0.0.0 --base /path"
      // The --base flag tells Vite to use a different base path for assets.
      const isRunCommand = baseArgs[0] === "run";
      args = isRunCommand
        ? [
            ...baseArgs,
            "--",
            "--port",
            String(port),
            "--host",
            hostname,
            "--base",
            baseForCli,
          ]
        : [
            ...baseArgs,
            "--port",
            String(port),
            "--host",
            hostname,
            "--base",
            baseForCli,
          ];
    }

    debugLog(`Spawning: ${cmd} ${args.join(" ")} in ${projectDir}`);

    const proc = spawn(cmd, args, {
      cwd: projectDir,
      env: portEnv,
      shell: true,
    });

    serverInfo.process = proc;

    const readyPromise = new Promise<void>((resolve, reject) => {
      const id = setTimeout(() => {
        reject(new Error(`Timeout waiting for dev server after ${timeout}ms`));
      }, timeout);

      let output = "";
      let hasResolved = false;

      const checkReady = (data: string) => {
        if (hasResolved) return false;

        output += data;
        // Common patterns for dev server ready messages
        const readyPatterns = [
          /Local:\s*(https?:\/\/[^\s]+)/i,
          /listening on\s*(https?:\/\/[^\s]+)/i,
          /server running at\s*(https?:\/\/[^\s]+)/i,
          /ready in/i,
          /localhost:\d+/i,
        ];

        for (const pattern of readyPatterns) {
          if (pattern.test(output)) {
            hasResolved = true;
            clearTimeout(id);
            serverInfo.status = "ready";
            console.log(
              `[DevServer] Ready at ${serverInfo.url} for ${projectDir}`
            );
            resolve();
            return true;
          }
        }
        return false;
      };

      proc.stdout?.on("data", (chunk) => {
        const str = chunk.toString();
        debugLog("stdout:", str);
        checkReady(str);
      });

      proc.stderr?.on("data", (chunk) => {
        const str = chunk.toString();
        debugLog("stderr:", str);
        // Some frameworks log to stderr
        checkReady(str);
      });

      proc.on("exit", (code) => {
        console.log(
          `[DevServer] Process exited with code ${code} for ${projectDir}`
        );
        if (serverInfo.status !== "ready") {
          clearTimeout(id);
          serverInfo.status = "error";
          serverInfo.error = `Dev server exited with code ${code}\n${output}`;
          reject(new Error(serverInfo.error));
        } else {
          // Process exited after we thought it was ready - mark as error
          console.log(
            `[DevServer] WARNING: Process exited after ready status!`
          );
          serverInfo.status = "error";
          serverInfo.error = `Dev server exited unexpectedly with code ${code}`;
        }
      });

      proc.on("error", (error) => {
        clearTimeout(id);
        serverInfo.status = "error";
        serverInfo.error = error.message;
        reject(error);
      });
    });

    try {
      await readyPromise;
    } catch (err) {
      // Error is already logged and status set
      debugLog("Dev server failed to become ready:", err);
    }
  }

  /**
   * Stop a dev server for a project.
   */
  stopDevServer(projectDir: string): void {
    const server = this.servers.get(projectDir);
    if (server) {
      console.log(`[DevServer] Stopping dev server for ${projectDir}`);
      try {
        server.process?.kill();
      } catch {
        // Ignore
      }
      this.servers.delete(projectDir);
    }
  }

  /**
   * Update last activity time to prevent idle cleanup.
   */
  touchProject(projectDir: string): void {
    const server = this.servers.get(projectDir);
    if (server) {
      server.lastActivity = Date.now();
    }
  }

  private cleanupIdleServers(): void {
    const now = Date.now();
    for (const [dir, server] of this.servers.entries()) {
      if (now - server.lastActivity > IDLE_TIMEOUT_MS) {
        console.log(`[DevServer] Stopping idle dev server for ${dir}`);
        this.stopDevServer(dir);
      }
    }
  }

  /**
   * Close all dev servers gracefully.
   */
  closeAll(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log(`[DevServer] Stopping ${this.servers.size} dev server(s)...`);
    for (const dir of this.servers.keys()) {
      this.stopDevServer(dir);
    }
  }

  /**
   * Check if a dev server exists for a directory.
   */
  hasServer(projectDir: string): boolean {
    return this.servers.has(projectDir);
  }

  /**
   * Get the number of active dev servers.
   */
  get serverCount(): number {
    return this.servers.size;
  }
}

// Singleton instance
export const devServerManager = new DevServerManager();
