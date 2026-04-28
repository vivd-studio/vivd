import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "path";
import * as net from "node:net";
import treeKill from "tree-kill";
import { detectProjectType, hasNodeModules, type ProjectConfig } from "./projectType.js";
import { ensureAstroCmsToolkit } from "./astroCmsToolkit.js";

interface DevServerInfo {
  url: string;
  process: ChildProcess;
  port: number;
  projectDir: string;
  basePath: string;
  lastActivity: number;
  status: "installing" | "starting" | "ready" | "error";
  error?: string;
  cancelled?: boolean;
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEVSERVER_KILL_GRACE_MS = 1_000;
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
const DEVSERVER_STATE_DIRNAME = ".vivd";
const DEVSERVER_DEPS_MARKER_FILENAME = "devserver-deps.json";

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

const hasPsCommand = (() => {
  try {
    const result = spawnSync("ps", ["--version"], { stdio: "ignore" });
    return result.error === undefined;
  } catch {
    return false;
  }
})();

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
      args: ["ci", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"],
    };
  }

  return {
    cmd: "npm",
    args: ["install", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"],
  };
}

function resolveNpmOptionalRepairInstallCommand(): { cmd: string; args: string[] } {
  return {
    cmd: "npm",
    args: ["install", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"],
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

type DevServerDepsMarker = {
  digest: string;
  packageManager: ProjectConfig["packageManager"];
  updatedAt: string;
};

function getProjectDependencyDigest(
  projectDir: string,
  packageManager: ProjectConfig["packageManager"]
): string | null {
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

  return hash.digest("hex").slice(0, 24);
}

function readDevServerDepsMarker(projectDir: string): DevServerDepsMarker | null {
  try {
    const markerPath = path.join(
      projectDir,
      DEVSERVER_STATE_DIRNAME,
      DEVSERVER_DEPS_MARKER_FILENAME
    );
    if (!fs.existsSync(markerPath)) return null;

    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf-8")) as Partial<DevServerDepsMarker>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.digest !== "string" || parsed.digest.length < 6) return null;
    if (
      parsed.packageManager !== "npm" &&
      parsed.packageManager !== "pnpm" &&
      parsed.packageManager !== "yarn"
    ) {
      return null;
    }

    return {
      digest: parsed.digest,
      packageManager: parsed.packageManager,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeDevServerDepsMarker(
  projectDir: string,
  marker: DevServerDepsMarker
): void {
  try {
    const dir = path.join(projectDir, DEVSERVER_STATE_DIRNAME);
    fs.mkdirSync(dir, { recursive: true });
    const markerPath = path.join(dir, DEVSERVER_DEPS_MARKER_FILENAME);
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), "utf-8");
  } catch {
    // Best-effort only.
  }
}

function getNodeModulesCacheArchivePath(
  projectDir: string,
  packageManager: ProjectConfig["packageManager"]
): string | null {
  if (!DEVSERVER_NODE_MODULES_CACHE_ENABLED) return null;

  const packageCacheRoot = getPackageCacheRoot();
  if (!packageCacheRoot) return null;

  const digest = getProjectDependencyDigest(projectDir, packageManager);
  if (!digest) return null;

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

function hasEsbuildPackage(projectDir: string): boolean {
  return fs.existsSync(
    path.join(projectDir, "node_modules", "esbuild", "package.json")
  );
}

function hasRollupPackage(projectDir: string): boolean {
  return fs.existsSync(
    path.join(projectDir, "node_modules", "rollup", "package.json")
  );
}

function removeNodeModules(projectDir: string): void {
  fs.rmSync(path.join(projectDir, "node_modules"), {
    recursive: true,
    force: true,
  });
}

function removeNpmInstallArtifacts(projectDir: string): void {
  removeNodeModules(projectDir);
  fs.rmSync(path.join(projectDir, "package-lock.json"), { force: true });
}

function removeNpmLockfile(projectDir: string): void {
  fs.rmSync(path.join(projectDir, "package-lock.json"), { force: true });
}

async function detectEsbuildBinaryMismatch(
  projectDir: string
): Promise<string | null> {
  if (!hasEsbuildPackage(projectDir)) return null;

  const sanityCheck = await runProcess(
    "node",
    ["-e", "const esbuild=require('esbuild');esbuild.transformSync('let x=1')"],
    {
      cwd: projectDir,
      timeoutMs: 20_000,
    }
  );

  if (sanityCheck.code === 0 && !sanityCheck.timedOut) {
    return null;
  }

  const output = `${sanityCheck.stderr}\n${sanityCheck.stdout}`;
  const normalized = output.toLowerCase();
  const hasVersionMismatch =
    (normalized.includes("host version") &&
      normalized.includes("does not match binary version")) ||
    normalized.includes("you installed esbuild for another platform");

  if (!hasVersionMismatch) return null;
  return output.trim() || "esbuild host/binary version mismatch";
}

function isMissingRollupNativeOptionalDependency(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    output.includes("@rollup/rollup-") &&
    (normalized.includes("cannot find module") ||
      normalized.includes("cannot find package") ||
      normalized.includes("module_not_found"))
  );
}

function isEsbuildBinaryMismatchMessage(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    (normalized.includes("node_modules/esbuild") &&
      normalized.includes("expected") &&
      normalized.includes("but got")) ||
    normalized.includes("you installed esbuild for another platform") ||
    (normalized.includes("host version") &&
      normalized.includes("does not match binary version"))
  );
}

async function detectRollupNativeOptionalDependencyFailure(
  projectDir: string
): Promise<string | null> {
  if (!hasRollupPackage(projectDir)) return null;

  const sanityCheck = await runProcess(
    "node",
    ["-e", "require('rollup')"],
    {
      cwd: projectDir,
      timeoutMs: 20_000,
    }
  );

  if (sanityCheck.code === 0 && !sanityCheck.timedOut) {
    return null;
  }

  const output = `${sanityCheck.stderr}\n${sanityCheck.stdout}`;
  if (!isMissingRollupNativeOptionalDependency(output)) return null;
  return output.trim() || "missing Rollup native optional dependency";
}

function formatInstallFailure(result: RunProcessResult): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  if (result.timedOut) return "Timed out";
  if (stderr) return stderr;
  if (stdout) return stdout;
  return `Exit code ${result.code}`;
}

function isPortAvailable(port: number, hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.on("error", () => resolve(false));
    server.listen({ port, host: hostname }, () => {
      server.close(() => resolve(true));
    });
  });
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
   * @param basePath - The base path for the proxy (the dev server itself always runs at "/")
   */
  async getOrStartDevServer(
    projectDir: string,
    _basePath: string = "/"
  ): Promise<{
    url: string | null;
    status: DevServerInfo["status"];
    error?: string;
  }> {
    if (this.server && this.server.projectDir === projectDir) {
      this.server.lastActivity = Date.now();
      return {
        url: this.server.status === "ready" ? this.server.url : null,
        status: this.server.status,
        error: this.server.error,
      };
    }

    if (this.server) {
      const status = this.server.status;
      const previousDir = this.server.projectDir;
      console.warn(
        `[DevServer] Found stale server state (${status}) for ${previousDir}. Restarting...`,
      );
      await this.stopDevServer({ reason: `stale-${status}` });
    }

    const config = detectProjectType(projectDir);
    if (config.mode !== "devserver" || !config.devCommand) {
      return { url: null, status: "error", error: "Not a dev server project" };
    }

    const port = await this.getAvailablePort("0.0.0.0");
    console.log(
      `[DevServer] Starting dev server for ${projectDir} on port ${port}`
    );

    // Important: The dev server itself always runs at base "/".
    // Studio now serves live preview directly from the runtime root and keeps
    // any remaining path-based preview compatibility outside the dev server.
    const devServerBasePath = "/";

    // Create initial entry with installing status
    const serverInfo: DevServerInfo = {
      url: `http://127.0.0.1:${port}`,
      process: null as unknown as ChildProcess,
      port,
      projectDir,
      basePath: devServerBasePath,
      lastActivity: Date.now(),
      status: hasNodeModules(projectDir) ? "starting" : "installing",
    };
    this.server = serverInfo;

    // Run npm install if needed (async)
    this.startServerAsync(
      projectDir,
      config,
      port,
      devServerBasePath,
      serverInfo
    );

    return { url: null, status: serverInfo.status };
  }

  async restartDevServer(
    projectDir: string,
    basePath: string,
    options?: { clean?: boolean; resetCaches?: boolean }
  ): Promise<{
    url: string | null;
    status: DevServerInfo["status"];
    error?: string;
  }> {
    await this.stopDevServer({
      reason:
        options?.clean
          ? "restart-reinstall"
          : options?.resetCaches
            ? "restart-reset-caches"
            : "restart",
    });
    if (options?.clean || options?.resetCaches) {
      const config = detectProjectType(projectDir);
      this.cleanDevServerCaches(projectDir, {
        removeNodeModules: Boolean(options?.clean),
        removeNpmLockfile: Boolean(options?.clean && config.packageManager === "npm"),
      });
    }
    return await this.getOrStartDevServer(projectDir, basePath);
  }

  private cleanDevServerCaches(
    projectDir: string,
    options?: { removeNodeModules?: boolean; removeNpmLockfile?: boolean }
  ): void {
    const toRemove = [
      path.join(projectDir, ".astro"),
      path.join(projectDir, ".vite"),
      path.join(projectDir, "node_modules", ".astro"),
      path.join(projectDir, "node_modules", ".vite"),
      path.join(projectDir, "node_modules", ".cache"),
    ];

    for (const dir of toRemove) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    if (options?.removeNodeModules) {
      try {
        removeNodeModules(projectDir);
      } catch {
        // ignore
      }
    }

    if (options?.removeNpmLockfile) {
      try {
        removeNpmLockfile(projectDir);
      } catch {
        // ignore
      }
    }
  }

  private async getAvailablePort(hostname: string): Promise<number> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const port = this.nextPort++;
      try {
        if (await isPortAvailable(port, hostname)) {
          return port;
        }
      } catch {
        // ignore and retry
      }
    }

    throw new Error(
      "[DevServer] Could not find an available port for the dev server",
    );
  }

  private killProcessTree(pid: number): Promise<void> {
    if (!hasPsCommand) {
      return new Promise((resolve) => {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          resolve();
          return;
        }

        setTimeout(() => {
          try {
            process.kill(pid, 0);
            process.kill(pid, "SIGKILL");
          } catch {
            // ignore
          }
          resolve();
        }, DEVSERVER_KILL_GRACE_MS);
      });
    }

    return new Promise((resolve) => {
      treeKill(pid, "SIGTERM", () => {
        setTimeout(() => {
          try {
            process.kill(pid, 0);
            treeKill(pid, "SIGKILL", () => resolve());
          } catch {
            resolve();
          }
        }, DEVSERVER_KILL_GRACE_MS);
      });
    });
  }

  private async startServerAsync(
    projectDir: string,
    config: ProjectConfig,
    port: number,
    basePath: string,
    serverInfo: DevServerInfo
  ): Promise<void> {
    const isActive = () =>
      this.server === serverInfo && serverInfo.cancelled !== true;

    let syncPaused = false;

    try {
      if (!isActive()) return;

      await ensureAstroCmsToolkit(projectDir, config.framework);

      if (!isActive()) return;

      let installedDependencies = false;
      let needsInstall = !hasNodeModules(projectDir);
      let forceNpmOptionalRepairInstall = false;
      const initialDepsDigest = getProjectDependencyDigest(
        projectDir,
        config.packageManager
      );

      if (!needsInstall && initialDepsDigest) {
        const marker = readDevServerDepsMarker(projectDir);
        const depsChanged = marker?.digest !== initialDepsDigest;
        const packageManagerChanged = marker?.packageManager !== config.packageManager;

        if (marker && (depsChanged || packageManagerChanged)) {
          console.warn(
            "[DevServer] Detected dependency changes (lockfile/package.json). Reinstalling dependencies."
          );
          debugLog(
            "Deps marker mismatch:",
            JSON.stringify({
              marker,
              initialDepsDigest,
              configPackageManager: config.packageManager,
            })
          );
          removeNodeModules(projectDir);
          needsInstall = true;
        }
      }

      if (!needsInstall) {
        const esbuildMismatch = await detectEsbuildBinaryMismatch(projectDir);
        if (esbuildMismatch) {
          console.warn(
            "[DevServer] Detected stale node_modules (esbuild mismatch). Reinstalling dependencies."
          );
          debugLog("esbuild mismatch details:", esbuildMismatch);
          removeNodeModules(projectDir);
          needsInstall = true;
        }
      }

      if (!needsInstall && config.packageManager === "npm") {
        const rollupNativeFailure =
          await detectRollupNativeOptionalDependencyFailure(projectDir);
        if (rollupNativeFailure) {
          console.warn(
            "[DevServer] Detected missing Rollup native optional dependency. Reinstalling dependencies without npm lockfile."
          );
          debugLog("Rollup native optional dependency failure:", rollupNativeFailure);
          removeNpmInstallArtifacts(projectDir);
          needsInstall = true;
          forceNpmOptionalRepairInstall = true;
        }
      }

      // Install dependencies if needed
      if (needsInstall) {
        serverInfo.status = "installing";
        setSyncPaused(true);
        syncPaused = true;

        try {
          let restoredFromCache = await restoreNodeModulesFromCache(
            projectDir,
            config.packageManager
          );

          if (restoredFromCache) {
            const esbuildMismatchAfterRestore =
              await detectEsbuildBinaryMismatch(projectDir);
            if (esbuildMismatchAfterRestore) {
              console.warn(
                "[DevServer] Cached node_modules is stale (esbuild mismatch). Falling back to fresh install."
              );
              debugLog(
                "esbuild mismatch after cache restore:",
                esbuildMismatchAfterRestore
              );
              removeNodeModules(projectDir);
              restoredFromCache = false;
            }
          }

          if (restoredFromCache && config.packageManager === "npm") {
            const rollupNativeFailureAfterRestore =
              await detectRollupNativeOptionalDependencyFailure(projectDir);
            if (rollupNativeFailureAfterRestore) {
              console.warn(
                "[DevServer] Cached node_modules is missing Rollup native optional dependency. Falling back to fresh npm install without lockfile."
              );
              debugLog(
                "Rollup native optional dependency failure after cache restore:",
                rollupNativeFailureAfterRestore
              );
              removeNpmInstallArtifacts(projectDir);
              restoredFromCache = false;
              forceNpmOptionalRepairInstall = true;
            }
          }

          if (!isActive()) return;

          if (!restoredFromCache) {
            console.log(`[DevServer] Installing dependencies in ${projectDir}`);

            const install =
              forceNpmOptionalRepairInstall && config.packageManager === "npm"
                ? resolveNpmOptionalRepairInstallCommand()
                : resolveInstallCommand(projectDir, config.packageManager);
            const installEnv = resolveInstallEnv(projectDir);
            debugLog(
              `Install command: ${install.cmd} ${install.args.join(" ")}`
            );

            let result = await runProcess(install.cmd, install.args, {
              cwd: projectDir,
              env: installEnv,
              timeoutMs: DEVSERVER_INSTALL_TIMEOUT_MS,
            });

            if (
              (result.code !== 0 || result.timedOut) &&
              config.packageManager === "npm" &&
              !forceNpmOptionalRepairInstall
            ) {
              const msg = formatInstallFailure(result);
              if (isEsbuildBinaryMismatchMessage(msg)) {
                console.warn(
                  "[DevServer] Detected esbuild native binary mismatch during npm install. Retrying without npm lockfile."
                );
                debugLog("esbuild install mismatch details:", msg);
                removeNpmInstallArtifacts(projectDir);
                forceNpmOptionalRepairInstall = true;

                const repairInstall = resolveNpmOptionalRepairInstallCommand();
                debugLog(
                  `Repair install command: ${repairInstall.cmd} ${repairInstall.args.join(" ")}`
                );
                result = await runProcess(
                  repairInstall.cmd,
                  repairInstall.args,
                  {
                    cwd: projectDir,
                    env: installEnv,
                    timeoutMs: DEVSERVER_INSTALL_TIMEOUT_MS,
                  }
                );
              }
            }

            if (result.code !== 0 || result.timedOut) {
              const msg = formatInstallFailure(result);
              console.error(
                `[DevServer] Failed to install dependencies: ${msg}`
              );
              serverInfo.status = "error";
              serverInfo.error = `${config.packageManager} install failed: ${msg}`;
              return;
            }

            if (!isActive()) return;

            const esbuildMismatchAfterInstall =
              await detectEsbuildBinaryMismatch(projectDir);
            if (esbuildMismatchAfterInstall) {
              console.error(
                "[DevServer] Dependencies installed, but esbuild is still mismatched."
              );
              debugLog(
                "esbuild mismatch after install:",
                esbuildMismatchAfterInstall
              );
              serverInfo.status = "error";
              serverInfo.error =
                "Dependency install completed but esbuild binary is incompatible";
              return;
            }

            if (config.packageManager === "npm") {
              const rollupNativeFailureAfterInstall =
                await detectRollupNativeOptionalDependencyFailure(projectDir);
              if (rollupNativeFailureAfterInstall) {
                if (forceNpmOptionalRepairInstall) {
                  console.error(
                    "[DevServer] Dependencies installed, but Rollup native optional dependency is still missing."
                  );
                  debugLog(
                    "Rollup native optional dependency failure after repair install:",
                    rollupNativeFailureAfterInstall
                  );
                  serverInfo.status = "error";
                  serverInfo.error =
                    "Dependency install completed but Rollup native optional dependency is missing";
                  return;
                }

                console.warn(
                  "[DevServer] Detected missing Rollup native optional dependency after npm install. Retrying without npm lockfile."
                );
                debugLog(
                  "Rollup native optional dependency failure after install:",
                  rollupNativeFailureAfterInstall
                );
                removeNpmInstallArtifacts(projectDir);

                const repairInstall = resolveNpmOptionalRepairInstallCommand();
                debugLog(
                  `Repair install command: ${repairInstall.cmd} ${repairInstall.args.join(" ")}`
                );
                const repairResult = await runProcess(
                  repairInstall.cmd,
                  repairInstall.args,
                  {
                    cwd: projectDir,
                    env: installEnv,
                    timeoutMs: DEVSERVER_INSTALL_TIMEOUT_MS,
                  }
                );

                if (repairResult.code !== 0 || repairResult.timedOut) {
                  const msg = formatInstallFailure(repairResult);
                  console.error(
                    `[DevServer] Failed to repair npm optional dependencies: ${msg}`
                  );
                  serverInfo.status = "error";
                  serverInfo.error = `npm optional dependency repair failed: ${msg}`;
                  return;
                }

                if (!isActive()) return;

                const esbuildMismatchAfterRepair =
                  await detectEsbuildBinaryMismatch(projectDir);
                if (esbuildMismatchAfterRepair) {
                  console.error(
                    "[DevServer] Dependencies repaired, but esbuild is still mismatched."
                  );
                  debugLog(
                    "esbuild mismatch after npm optional dependency repair:",
                    esbuildMismatchAfterRepair
                  );
                  serverInfo.status = "error";
                  serverInfo.error =
                    "Dependency repair completed but esbuild binary is incompatible";
                  return;
                }

                const rollupNativeFailureAfterRepair =
                  await detectRollupNativeOptionalDependencyFailure(projectDir);
                if (rollupNativeFailureAfterRepair) {
                  console.error(
                    "[DevServer] Dependencies repaired, but Rollup native optional dependency is still missing."
                  );
                  debugLog(
                    "Rollup native optional dependency failure after npm optional dependency repair:",
                    rollupNativeFailureAfterRepair
                  );
                  serverInfo.status = "error";
                  serverInfo.error =
                    "Dependency repair completed but Rollup native optional dependency is missing";
                  return;
                }
              }
            }

            installedDependencies = true;
          }

          if (!isActive()) return;

          if (installedDependencies) {
            await writeNodeModulesCache(projectDir, config.packageManager);
          }
        } finally {
          if (syncPaused) {
            setSyncPaused(false);
            syncPaused = false;
          }
        }
      }

      if (!isActive()) return;

      const finalDepsDigest = getProjectDependencyDigest(
        projectDir,
        config.packageManager
      );
      if (finalDepsDigest) {
        writeDevServerDepsMarker(projectDir, {
          digest: finalDepsDigest,
          packageManager: config.packageManager,
          updatedAt: new Date().toISOString(),
        });
      }

      serverInfo.status = "starting";

      // Start the dev server
      await this.spawnDevServer(projectDir, config, port, basePath, serverInfo);

      if (!isActive()) {
        const pid = serverInfo.process?.pid;
        if (typeof pid === "number" && Number.isFinite(pid) && pid > 0) {
          try {
            await this.killProcessTree(pid);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DevServer] Error starting dev server: ${msg}`);
      if (!isActive()) return;
      serverInfo.status = "error";
      serverInfo.error = msg;
    } finally {
      if (syncPaused) {
        setSyncPaused(false);
      }
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
  async stopDevServer(options?: { reason?: string }): Promise<boolean> {
    const server = this.server;
    if (!server) return false;

    server.cancelled = true;
    this.server = null;

    console.log(
      `[DevServer] Stopping dev server for ${server.projectDir}${options?.reason ? ` (${options.reason})` : ""}`,
    );

    const pid = server.process?.pid;
    if (typeof pid === "number" && Number.isFinite(pid) && pid > 0) {
      try {
        await this.killProcessTree(pid);
      } catch {
        // Best-effort only.
      }
    }

    return true;
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
      void this.stopDevServer({ reason: "idle-timeout" });
    }
  }

  /**
   * Close all resources gracefully.
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    await this.stopDevServer({ reason: "close" });
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
