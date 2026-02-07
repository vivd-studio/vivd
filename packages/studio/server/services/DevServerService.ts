import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "path";
import { detectProjectType, hasNodeModules, type ProjectConfig } from "./projectType.js";

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

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEV_SERVER_PORT_START = Math.max(
  1024,
  Number.parseInt(process.env.DEV_SERVER_PORT_START || "5100", 10) || 5100
);
const DEVSERVER_INSTALL_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.DEVSERVER_INSTALL_TIMEOUT_MS || "900000", 10) || 900000
);
const DEVSERVER_NODE_MODULES_CACHE_ENABLED =
  process.env.DEVSERVER_NODE_MODULES_CACHE !== "0";
const SYNC_PAUSE_FILE_PATH =
  process.env.VIVD_SYNC_PAUSE_FILE || "/tmp/vivd-sync.pause";

const MAX_CAPTURE_BYTES = 64 * 1024;

type RunProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const isDebugEnabled = process.env.DEVSERVER_DEBUG === "1";
const debugLog = (...args: unknown[]) => {
  if (!isDebugEnabled) return;
  console.log("[DevServer DEBUG]", ...args);
};

function resolveInstallCommand(
  projectDir: string,
  packageManager: ProjectConfig["packageManager"]
): { cmd: string; args: string[] } {
  if (packageManager === "pnpm") {
    if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
      return {
        cmd: "pnpm",
        args: ["install", "--frozen-lockfile", "--prefer-offline"],
      };
    }
    return { cmd: "pnpm", args: ["install", "--prefer-offline"] };
  }

  if (packageManager === "yarn") {
    if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
      return {
        cmd: "yarn",
        args: ["install", "--frozen-lockfile", "--prefer-offline"],
      };
    }
    return { cmd: "yarn", args: ["install", "--prefer-offline"] };
  }

  if (
    fs.existsSync(path.join(projectDir, "package-lock.json")) ||
    fs.existsSync(path.join(projectDir, "npm-shrinkwrap.json"))
  ) {
    return {
      cmd: "npm",
      args: ["ci", "--prefer-offline", "--no-audit", "--no-fund"],
    };
  }

  return {
    cmd: "npm",
    args: ["install", "--prefer-offline", "--no-audit", "--no-fund"],
  };
}

function resolveInstallEnv(projectDir: string): NodeJS.ProcessEnv {
  const installEnv: NodeJS.ProcessEnv = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };

  const opencodeDataHome =
    installEnv.VIVD_OPENCODE_DATA_HOME || installEnv.XDG_DATA_HOME || null;
  if (!opencodeDataHome) return installEnv;

  const packageCacheRoot = path.join(opencodeDataHome, "package-cache");
  const npmCacheDir = installEnv.npm_config_cache || path.join(packageCacheRoot, "npm");
  const pnpmStoreDir =
    installEnv.pnpm_config_store_dir || path.join(packageCacheRoot, "pnpm-store");
  const yarnCacheDir = installEnv.YARN_CACHE_FOLDER || path.join(packageCacheRoot, "yarn");

  installEnv.npm_config_cache = npmCacheDir;
  installEnv.pnpm_config_store_dir = pnpmStoreDir;
  installEnv.PNPM_STORE_PATH = installEnv.PNPM_STORE_PATH || pnpmStoreDir;
  installEnv.YARN_CACHE_FOLDER = yarnCacheDir;

  fs.mkdirSync(npmCacheDir, { recursive: true });
  fs.mkdirSync(pnpmStoreDir, { recursive: true });
  fs.mkdirSync(yarnCacheDir, { recursive: true });

  debugLog(
    "Using package-manager cache",
    JSON.stringify({
      npmCacheDir,
      pnpmStoreDir,
      yarnCacheDir,
      projectDir,
    })
  );

  return installEnv;
}

function setSyncPaused(paused: boolean): void {
  try {
    if (paused) {
      fs.mkdirSync(path.dirname(SYNC_PAUSE_FILE_PATH), { recursive: true });
      fs.writeFileSync(SYNC_PAUSE_FILE_PATH, "1", "utf-8");
      return;
    }
    fs.rmSync(SYNC_PAUSE_FILE_PATH, { force: true });
  } catch {
    // Best-effort only.
  }
}

function runProcess(
  cmd: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (target: "stdout" | "stderr", chunk: unknown) => {
      const next = typeof chunk === "string" ? chunk : Buffer.from(chunk as Buffer).toString();
      if (!next) return;

      if (target === "stdout") {
        stdout = (stdout + next).slice(-MAX_CAPTURE_BYTES);
      } else {
        stderr = (stderr + next).slice(-MAX_CAPTURE_BYTES);
      }
    };

    proc.stdout?.on("data", (chunk) => append("stdout", chunk));
    proc.stderr?.on("data", (chunk) => append("stderr", chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, options.timeoutMs);
    timeout.unref?.();

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      append("stderr", err instanceof Error ? err.message : String(err));
      resolve({ code: 1, stdout, stderr, timedOut });
    });
  });
}

function getPackageCacheRoot(): string | null {
  if (process.env.VIVD_PACKAGE_CACHE_DIR) {
    return process.env.VIVD_PACKAGE_CACHE_DIR;
  }

  const opencodeDataHome =
    process.env.VIVD_OPENCODE_DATA_HOME || process.env.XDG_DATA_HOME || null;
  if (!opencodeDataHome) return null;
  return path.join(opencodeDataHome, "package-cache");
}

function getNodeModulesCacheArchivePath(
  projectDir: string,
  packageManager: ProjectConfig["packageManager"]
): string | null {
  if (!DEVSERVER_NODE_MODULES_CACHE_ENABLED) return null;

  const packageCacheRoot = getPackageCacheRoot();
  if (!packageCacheRoot) return null;

  const filesForHash: string[] = [];
  const packageJsonPath = path.join(projectDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    filesForHash.push(packageJsonPath);
  }

  const lockfileCandidates =
    packageManager === "pnpm"
      ? ["pnpm-lock.yaml"]
      : packageManager === "yarn"
        ? ["yarn.lock"]
        : ["package-lock.json", "npm-shrinkwrap.json"];

  for (const lockfileName of lockfileCandidates) {
    const lockfilePath = path.join(projectDir, lockfileName);
    if (fs.existsSync(lockfilePath)) {
      filesForHash.push(lockfilePath);
    }
  }

  if (filesForHash.length === 0) return null;

  const hash = createHash("sha256");
  for (const filePath of filesForHash) {
    hash.update(path.basename(filePath));
    hash.update("\n");
    hash.update(fs.readFileSync(filePath));
    hash.update("\n");
  }

  const digest = hash.digest("hex").slice(0, 24);
  return path.join(packageCacheRoot, "node-modules", `${packageManager}-${digest}.tar.gz`);
}

async function restoreNodeModulesFromCache(
  projectDir: string,
  packageManager: ProjectConfig["packageManager"]
): Promise<boolean> {
  const archivePath = getNodeModulesCacheArchivePath(projectDir, packageManager);
  if (!archivePath || !fs.existsSync(archivePath)) return false;

  console.log(
    `[DevServer] Restoring node_modules cache (${path.basename(archivePath)})`
  );

  const nodeModulesDir = path.join(projectDir, "node_modules");
  fs.rmSync(nodeModulesDir, { recursive: true, force: true });

  const result = await runProcess(
    "tar",
    ["-xzf", archivePath, "-C", projectDir],
    {
      cwd: projectDir,
      timeoutMs: DEVSERVER_INSTALL_TIMEOUT_MS,
    }
  );

  if (result.code === 0 && hasNodeModules(projectDir)) {
    return true;
  }

  const stderr = result.stderr.trim();
  if (stderr) {
    console.warn(`[DevServer] Failed to restore node_modules cache: ${stderr}`);
  } else if (result.timedOut) {
    console.warn("[DevServer] Failed to restore node_modules cache: timed out");
  } else {
    console.warn("[DevServer] Failed to restore node_modules cache");
  }

  return false;
}

async function writeNodeModulesCache(
  projectDir: string,
  packageManager: ProjectConfig["packageManager"]
): Promise<void> {
  const archivePath = getNodeModulesCacheArchivePath(projectDir, packageManager);
  if (!archivePath) return;
  if (!hasNodeModules(projectDir)) return;
  if (fs.existsSync(archivePath)) return;

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const tmpArchivePath = `${archivePath}.tmp-${Date.now()}`;

  const env = { ...process.env, GZIP: process.env.GZIP || "-1" };

  const args = [
    "--warning=no-file-changed",
    "--warning=no-file-removed",
    "--warning=no-file-shrank",
    "--ignore-failed-read",
    "-czf",
    tmpArchivePath,
    "--exclude=node_modules/.cache",
    "--exclude=node_modules/.vite",
    "--exclude=node_modules/**/.cache",
    "--exclude=node_modules/**/.vite",
    "--exclude=node_modules/**/.astro",
    "-C",
    projectDir,
    "node_modules",
  ];

  const result = await runProcess("tar", args, {
    cwd: projectDir,
    env,
    timeoutMs: DEVSERVER_INSTALL_TIMEOUT_MS,
  });

  const hasTmp =
    fs.existsSync(tmpArchivePath) && fs.statSync(tmpArchivePath).size > 0;
  const success = result.code === 0 || (result.code === 1 && hasTmp);

  if (!success) {
    const stderr = result.stderr.trim();
    if (stderr) {
      console.warn(`[DevServer] Failed to write node_modules cache: ${stderr}`);
    } else if (result.timedOut) {
      console.warn("[DevServer] Failed to write node_modules cache: timed out");
    } else {
      console.warn("[DevServer] Failed to write node_modules cache");
    }
    fs.rmSync(tmpArchivePath, { force: true });
    return;
  }

  try {
    fs.renameSync(tmpArchivePath, archivePath);
    console.log(
      `[DevServer] Saved node_modules cache (${path.basename(archivePath)})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[DevServer] Failed to finalize node_modules cache: ${msg}`);
    fs.rmSync(tmpArchivePath, { force: true });
  }
}

/**
 * Manages a single dev server instance for the studio workspace.
 */
export class DevServerService {
  private server: DevServerInfo | null = null;
  private nextPort = DEV_SERVER_PORT_START;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleServer();
    }, 60 * 1000);
  }

  /**
   * Get project configuration (static vs dev server).
   */
  getProjectConfig(projectDir: string): ProjectConfig {
    return detectProjectType(projectDir);
  }

  /**
   * Get the status of the dev server.
   */
  getDevServerStatus(): "none" | "installing" | "starting" | "ready" | "error" {
    if (!this.server) return "none";
    return this.server.status;
  }

  /**
   * Get dev server URL if ready.
   */
  getDevServerUrl(): string | null {
    if (this.server?.status === "ready") {
      this.server.lastActivity = Date.now();
      return this.server.url;
    }
    return null;
  }

  /**
   * Start or get an existing dev server for a project.
   * @param projectDir - The project directory path
   * @param basePath - The base path for the dev server
   */
  async getOrStartDevServer(
    projectDir: string,
    basePath: string = "/"
  ): Promise<{
    url: string | null;
    status: DevServerInfo["status"];
    error?: string;
  }> {
    if (this.server) {
      this.server.lastActivity = Date.now();
      return {
        url: this.server.status === "ready" ? this.server.url : null,
        status: this.server.status,
        error: this.server.error,
      };
    }

    const config = detectProjectType(projectDir);
    if (config.mode !== "devserver" || !config.devCommand) {
      return { url: null, status: "error", error: "Not a dev server project" };
    }

    const port = this.nextPort++;
    console.log(
      `[DevServer] Starting dev server for ${projectDir} on port ${port}`
    );

    // Create initial entry with installing status
    const serverInfo: DevServerInfo = {
      url: `http://127.0.0.1:${port}`,
      process: null as unknown as ChildProcess,
      port,
      projectDir,
      basePath,
      lastActivity: Date.now(),
      status: hasNodeModules(projectDir) ? "starting" : "installing",
    };
    this.server = serverInfo;

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
      let installedDependencies = false;

      // Install dependencies if needed
      if (!hasNodeModules(projectDir)) {
        serverInfo.status = "installing";
        setSyncPaused(true);

        const restoredFromCache = await restoreNodeModulesFromCache(
          projectDir,
          config.packageManager
        );

        if (!restoredFromCache) {
          console.log(`[DevServer] Installing dependencies in ${projectDir}`);

          const install = resolveInstallCommand(projectDir, config.packageManager);
          const installEnv = resolveInstallEnv(projectDir);
          debugLog(`Install command: ${install.cmd} ${install.args.join(" ")}`);

          const result = await runProcess(install.cmd, install.args, {
            cwd: projectDir,
            env: installEnv,
            timeoutMs: DEVSERVER_INSTALL_TIMEOUT_MS,
          });

          if (result.code !== 0 || result.timedOut) {
            const stderr = result.stderr.trim();
            const tail = stderr || result.stdout.trim();
            const msg = result.timedOut
              ? "Timed out"
              : tail
                ? tail
                : `Exit code ${result.code}`;
            console.error(`[DevServer] Failed to install dependencies: ${msg}`);
            serverInfo.status = "error";
            serverInfo.error = `${config.packageManager} install failed: ${msg}`;
            setSyncPaused(false);
            return;
          }

          installedDependencies = true;
        }

        if (installedDependencies) {
          await writeNodeModulesCache(projectDir, config.packageManager);
        }

        setSyncPaused(false);
      }

      serverInfo.status = "starting";

      // Start the dev server
      await this.spawnDevServer(projectDir, config, port, basePath, serverInfo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DevServer] Error starting dev server: ${msg}`);
      serverInfo.status = "error";
      serverInfo.error = msg;
      setSyncPaused(false);
    }
  }

  private async spawnDevServer(
    projectDir: string,
    config: ProjectConfig,
    port: number,
    basePath: string,
    serverInfo: DevServerInfo
  ): Promise<void> {
    const hostname = "0.0.0.0";
    const timeout = 60000;

    const portEnv: Record<string, string> = {
      ...process.env,
      PORT: String(port),
      HOST: hostname,
    };

    const normalizedBasePath = basePath.startsWith("/")
      ? basePath
      : `/${basePath}`;
    const baseForCli = normalizedBasePath.endsWith("/")
      ? normalizedBasePath
      : `${normalizedBasePath}/`;

    let cmd: string;
    let args: string[];

    if (config.framework === "astro") {
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
      const [rawCmd, ...baseArgs] = config.devCommand!.split(" ");
      cmd = rawCmd;

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
      debugLog("Dev server failed to become ready:", err);
    }
  }

  /**
   * Stop the dev server.
   */
  stopDevServer(): void {
    if (this.server) {
      console.log(
        `[DevServer] Stopping dev server for ${this.server.projectDir}`
      );
      try {
        this.server.process?.kill();
      } catch {
        // Ignore
      }
      this.server = null;
    }
  }

  /**
   * Update last activity time to prevent idle cleanup.
   */
  touch(): void {
    if (this.server) {
      this.server.lastActivity = Date.now();
    }
  }

  private cleanupIdleServer(): void {
    if (!this.server) return;

    const now = Date.now();
    if (now - this.server.lastActivity > IDLE_TIMEOUT_MS) {
      console.log(
        `[DevServer] Stopping idle dev server for ${this.server.projectDir}`
      );
      this.stopDevServer();
    }
  }

  /**
   * Close all resources gracefully.
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.stopDevServer();
  }

  /**
   * Check if a dev server is running.
   */
  hasServer(): boolean {
    return this.server !== null;
  }
}

// Singleton instance for studio
export const devServerService = new DevServerService();
