import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import crypto from "node:crypto";
import treeKill from "tree-kill";
import type {
  StudioMachineProvider,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "./types";
import { getActiveTenantId, getVersionDir } from "../../generator/versionUtils";
import {
  createS3Client,
  downloadBucketPrefixToDirectory,
  getObjectStorageConfigFromEnv,
  parseS3Uri,
  uploadDirectoryToBucket,
} from "../ObjectStorageService";
import type { S3Client } from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface StudioProcess {
  process: ChildProcess;
  port: number;
  studioId: string;
  projectSlug: string;
  version: number;
  lastActivityAt: Date;
  objectStorageSync: LocalObjectStorageSync | null;
}

interface StorageSyncTarget {
  name: "source" | "opencode";
  bucket: string;
  keyPrefix: string;
  localDir: string;
  excludeDirNames: string[];
}

interface LocalObjectStorageSync {
  client: S3Client;
  targets: StorageSyncTarget[];
  syncIntervalSeconds: number;
  intervalHandle: NodeJS.Timeout | null;
  syncInFlight: Promise<void> | null;
  stopped: boolean;
}

const STUDIO_PORT_START = Math.max(
  1024,
  Number.parseInt(process.env.STUDIO_MACHINE_PORT_START || "3100", 10) || 3100,
);
const MAX_STUDIOS = 3;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

async function ensureOpencodeAuthFile(xdgDataHome: string, googleApiKey?: string): Promise<void> {
  if (!googleApiKey) return;

  const opencodeDir = path.join(xdgDataHome, "opencode");
  const authPath = path.join(opencodeDir, "auth.json");
  await fs.promises.mkdir(opencodeDir, { recursive: true });

  const payload = {
    google: {
      type: "api",
      key: googleApiKey,
    },
  };

  await fs.promises.writeFile(authPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function migrateLegacyOpencodeData(
  workspaceDir: string,
  opencodeDataHome: string
): Promise<void> {
  const legacyDir = path.join(workspaceDir, ".vivd", "opencode-data");
  const source = path.resolve(legacyDir);
  const target = path.resolve(opencodeDataHome);

  if (source === target) return;
  if (!fs.existsSync(source)) return;

  await fs.promises.mkdir(path.dirname(target), { recursive: true });

  if (!fs.existsSync(target)) {
    await fs.promises.rename(source, target);
    return;
  }

  const sourceEntries = await fs.promises.readdir(source);
  if (sourceEntries.length === 0) {
    await fs.promises.rm(source, { recursive: true, force: true });
    return;
  }

  console.warn(
    `[StudioMachine] Legacy OpenCode data exists at ${source} but target ${target} already exists. Keeping both paths unchanged.`
  );
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        server.close(() => resolve(true));
      })
      .listen(port, "127.0.0.1");
  });
}

/**
 * Local studio machine provider.
 *
 * Spawns @vivd/studio as a child process and returns a localhost URL.
 * This is used for connected-mode testing on a single dev machine.
 */
export class LocalStudioMachineProvider implements StudioMachineProvider {
  kind = "local" as const;

  private studios = new Map<string, StudioProcess>();
  private nextPort = STUDIO_PORT_START;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private studioBuildPromise: Promise<void> | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleStudios();
    }, 60 * 1000);
  }

  private key(projectSlug: string, version: number): string {
    return `${projectSlug}:${version}`;
  }

  async ensureRunning(args: StudioMachineStartArgs): Promise<StudioMachineStartResult> {
    const key = this.key(args.projectSlug, args.version);

    const existing = this.studios.get(key);
    if (existing) {
      existing.lastActivityAt = new Date();
      return {
        studioId: existing.studioId,
        url: this.getPublicUrl(existing.port),
        port: existing.port,
      };
    }

    if (this.studios.size >= MAX_STUDIOS) {
      console.log(`[StudioMachine] At max limit (${MAX_STUDIOS}), evicting...`);
      this.stopOldestStudio();
    }

    const port = await this.allocatePort();
    const studioId = args.env.STUDIO_ID || crypto.randomUUID();

    console.log(
      `[StudioMachine] Starting local studio for ${args.projectSlug}/v${args.version} on port ${port}`
    );

    const studioPath = this.resolveStudioPackagePath();
    await this.ensureStudioBuilt(studioPath);

    const workspaceDir = getVersionDir(args.projectSlug, args.version);

    const env: Record<string, string> = {
      ...process.env,
      PORT: String(port),
      STUDIO_ID: studioId,
      VIVD_TENANT_ID: getActiveTenantId(),
      VIVD_PROJECT_SLUG: args.projectSlug,
      VIVD_PROJECT_VERSION: String(args.version),
      VIVD_WORKSPACE_DIR: workspaceDir,
      // Avoid cross-studio port collisions in local mode (Fly machines are isolated).
      DEV_SERVER_PORT_START: String(port + 2000),
      OPENCODE_PORT_START: String(port + 3000),
      // Prevent one studio instance from killing another instance's OpenCode processes.
      OPENCODE_KILL_ORPHANS: "0",
    };

    for (const [k, v] of Object.entries(args.env)) {
      if (typeof v === "string") env[k] = v;
    }

    const opencodeDataHome =
      env.VIVD_OPENCODE_DATA_HOME ||
      path.join(path.dirname(workspaceDir), ".vivd-opencode-data");
    env.VIVD_OPENCODE_DATA_HOME = opencodeDataHome;
    env.XDG_DATA_HOME = opencodeDataHome;
    await migrateLegacyOpencodeData(workspaceDir, opencodeDataHome);
    await ensureOpencodeAuthFile(opencodeDataHome, env.GOOGLE_API_KEY);

    const objectStorageSync = this.createObjectStorageSync({
      env,
      projectSlug: args.projectSlug,
      version: args.version,
      workspaceDir,
    });
    if (objectStorageSync) {
      await this.hydrateWorkspaceFromObjectStorage(
        args.projectSlug,
        args.version,
        objectStorageSync
      );
      this.startObjectStorageSyncLoop(
        args.projectSlug,
        args.version,
        objectStorageSync
      );
    }

    const recentOutput: string[] = [];
    const recordOutput = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      recentOutput.push(trimmed);
      while (recentOutput.length > 25) recentOutput.shift();
    };

    const proc = spawn("npm", ["run", "start"], {
      cwd: studioPath,
      env,
      shell: true,
      stdio: "pipe",
    });

    proc.stdout?.on("data", (data) => {
      const text = data.toString();
      recordOutput(text);
      console.log(`[Studio ${args.projectSlug}] ${text.trim()}`);
    });

    proc.stderr?.on("data", (data) => {
      const text = data.toString();
      recordOutput(text);
      console.error(`[Studio ${args.projectSlug}] ${text.trim()}`);
    });

    proc.on("exit", (code) => {
      void this.onStudioExit({
        key,
        projectSlug: args.projectSlug,
        version: args.version,
        objectStorageSync,
        code,
      });
    });

    this.studios.set(key, {
      process: proc,
      port,
      studioId,
      projectSlug: args.projectSlug,
      version: args.version,
      lastActivityAt: new Date(),
      objectStorageSync,
    });

    try {
      await this.waitForReady(proc, port);
    } catch (err) {
      this.studios.delete(key);
      if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
        treeKill(proc.pid, "SIGTERM");
      }

      const lastLine = recentOutput.at(-1);
      const suffix = lastLine ? `\nLast output: ${lastLine}` : "";
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${message}${suffix}`);
    }

    return { studioId, url: this.getPublicUrl(port), port };
  }

  stop(projectSlug: string, version: number): void {
    const key = this.key(projectSlug, version);
    const studio = this.studios.get(key);
    if (!studio) return;

    console.log(`[StudioMachine] Stopping local studio for ${projectSlug}/v${version}`);
    if (studio.process.pid) {
      treeKill(studio.process.pid, "SIGTERM");
    }
    this.studios.delete(key);
  }

  getUrl(projectSlug: string, version: number): string | null {
    const studio = this.studios.get(this.key(projectSlug, version));
    if (!studio) return null;
    studio.lastActivityAt = new Date();
    return this.getPublicUrl(studio.port);
  }

  isRunning(projectSlug: string, version: number): boolean {
    return this.studios.has(this.key(projectSlug, version));
  }

  stopAll(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log(`[StudioMachine] Stopping ${this.studios.size} local studio(s)...`);
    for (const studio of this.studios.values()) {
      if (studio.process.pid) {
        treeKill(studio.process.pid, "SIGTERM");
      }
    }
    this.studios.clear();
  }

  private getPublicUrl(port: number): string {
    const host = process.env.STUDIO_PUBLIC_HOST || "localhost";
    const protocol = process.env.STUDIO_PUBLIC_PROTOCOL || "http";
    return `${protocol}://${host}:${port}`;
  }

  private getInternalUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  private createObjectStorageSync(options: {
    env: Record<string, string>;
    projectSlug: string;
    version: number;
    workspaceDir: string;
  }): LocalObjectStorageSync | null {
    const hasAnyStorageEnv =
      Boolean(options.env.VIVD_S3_SOURCE_URI) ||
      Boolean(options.env.VIVD_S3_OPENCODE_URI) ||
      Boolean(options.env.VIVD_S3_BUCKET) ||
      Boolean(options.env.R2_BUCKET) ||
      Boolean(options.env.VIVD_S3_PREFIX) ||
      Boolean(options.env.VIVD_S3_OPENCODE_PREFIX);

    if (!hasAnyStorageEnv) {
      return null;
    }

    const sourceUri = (options.env.VIVD_S3_SOURCE_URI || "").trim();
    const opencodeUri = (options.env.VIVD_S3_OPENCODE_URI || "").trim();

    let parsedSource:
      | {
          bucket: string;
          keyPrefix: string;
        }
      | undefined;
    let parsedOpencode:
      | {
          bucket: string;
          keyPrefix: string;
        }
      | undefined;

    if (sourceUri) {
      parsedSource = parseS3Uri(sourceUri);
    }
    if (opencodeUri) {
      parsedOpencode = parseS3Uri(opencodeUri);
    }

    // Keep source URI support even when no VIVD_S3_BUCKET/R2_BUCKET is explicitly set.
    const envForConfig: Record<string, string> = { ...options.env };
    if (!envForConfig.VIVD_S3_BUCKET && !envForConfig.R2_BUCKET) {
      if (parsedSource) {
        envForConfig.VIVD_S3_BUCKET = parsedSource.bucket;
      } else if (parsedOpencode) {
        envForConfig.VIVD_S3_BUCKET = parsedOpencode.bucket;
      }
    }

    const storageConfig = getObjectStorageConfigFromEnv(envForConfig);
    const client = createS3Client(storageConfig);

    const tenantId = (options.env.VIVD_TENANT_ID || getActiveTenantId()).trim();
    const defaultSourceBasePrefix = `tenants/${tenantId}/projects/${options.projectSlug}/v${options.version}`;
    const configuredSourceBasePrefix = trimSlashes(
      options.env.VIVD_S3_PREFIX || defaultSourceBasePrefix
    );
    const sourceKeyPrefix = parsedSource
      ? trimSlashes(parsedSource.keyPrefix)
      : `${configuredSourceBasePrefix}/source`;

    const defaultOpencodePrefix = `tenants/${tenantId}/projects/${options.projectSlug}/opencode`;
    const opencodeKeyPrefix = parsedOpencode
      ? trimSlashes(parsedOpencode.keyPrefix)
      : trimSlashes(options.env.VIVD_S3_OPENCODE_PREFIX || defaultOpencodePrefix);
    const opencodeDir =
      options.env.VIVD_OPENCODE_DATA_HOME ||
      path.join(path.dirname(options.workspaceDir), ".vivd-opencode-data");

    const targets: StorageSyncTarget[] = [
      {
        name: "source",
        bucket: parsedSource?.bucket || storageConfig.bucket,
        keyPrefix: sourceKeyPrefix,
        localDir: options.workspaceDir,
        // Keep legacy `.vivd/opencode-data` out of source sync if it still exists.
        excludeDirNames: ["node_modules", "opencode-data"],
      },
      {
        name: "opencode",
        bucket: parsedOpencode?.bucket || storageConfig.bucket,
        keyPrefix: opencodeKeyPrefix,
        localDir: opencodeDir,
        excludeDirNames: [],
      },
    ];

    return {
      client,
      targets,
      syncIntervalSeconds: parsePositiveInt(
        options.env.VIVD_S3_SYNC_INTERVAL_SECONDS,
        30
      ),
      intervalHandle: null,
      syncInFlight: null,
      stopped: false,
    };
  }

  private async hydrateWorkspaceFromObjectStorage(
    projectSlug: string,
    version: number,
    sync: LocalObjectStorageSync
  ): Promise<void> {
    for (const target of sync.targets) {
      console.log(
        `[StudioMachine] Hydrating ${target.name} for ${projectSlug}/v${version} from s3://${target.bucket}/${trimSlashes(target.keyPrefix)}`
      );

      const result = await downloadBucketPrefixToDirectory({
        client: sync.client,
        bucket: target.bucket,
        keyPrefix: target.keyPrefix,
        localDir: target.localDir,
        excludeDirNames: target.excludeDirNames,
      });

      if (result.errors.length > 0) {
        console.warn(
          `[StudioMachine] ${target.name} hydration completed with ${result.errors.length} error(s) for ${projectSlug}/v${version}`
        );
        const first = result.errors[0];
        if (first) {
          console.warn(
            `[StudioMachine] First ${target.name} hydration error: ${first.key} -> ${first.error}`
          );
        }
      } else {
        console.log(
          `[StudioMachine] ${target.name} hydration completed (${result.filesDownloaded} files, ${result.bytesDownloaded} bytes) for ${projectSlug}/v${version}`
        );
      }
    }
  }

  private startObjectStorageSyncLoop(
    projectSlug: string,
    version: number,
    sync: LocalObjectStorageSync
  ): void {
    if (sync.stopped) return;
    if (sync.intervalHandle) clearInterval(sync.intervalHandle);

    sync.intervalHandle = setInterval(() => {
      void this.syncWorkspaceToObjectStorage(projectSlug, version, sync, "periodic");
    }, sync.syncIntervalSeconds * 1000);
    sync.intervalHandle.unref?.();

    console.log(
      `[StudioMachine] Periodic object storage sync enabled for ${projectSlug}/v${version} (interval=${sync.syncIntervalSeconds}s)`
    );
  }

  private async syncWorkspaceToObjectStorage(
    projectSlug: string,
    version: number,
    sync: LocalObjectStorageSync,
    reason: "periodic" | "final"
  ): Promise<void> {
    if (sync.stopped && reason !== "final") {
      return;
    }

    if (sync.syncInFlight) {
      if (reason === "periodic") return;
      try {
        await sync.syncInFlight;
      } catch {
        // The final sync below will retry once.
      }
    }

    const run = (async () => {
      for (const target of sync.targets) {
        const result = await uploadDirectoryToBucket({
          client: sync.client,
          bucket: target.bucket,
          localDir: target.localDir,
          keyPrefix: target.keyPrefix,
          excludeDirNames: target.excludeDirNames,
        });

        if (result.errors.length > 0) {
          console.warn(
            `[StudioMachine] ${reason} ${target.name} sync completed with ${result.errors.length} error(s) for ${projectSlug}/v${version}`
          );
          const first = result.errors[0];
          if (first) {
            console.warn(
              `[StudioMachine] First ${reason} ${target.name} sync error: ${first.key} -> ${first.error}`
            );
          }
        } else if (reason === "final") {
          console.log(
            `[StudioMachine] Final ${target.name} sync completed (${result.filesUploaded} files, ${result.bytesUploaded} bytes) for ${projectSlug}/v${version}`
          );
        }
      }
    })()
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[StudioMachine] ${reason} sync failed for ${projectSlug}/v${version}: ${message}`
        );
      })
      .finally(() => {
        if (sync.syncInFlight === run) {
          sync.syncInFlight = null;
        }
      });

    sync.syncInFlight = run;
    await run;
  }

  private async stopObjectStorageSync(
    projectSlug: string,
    version: number,
    sync: LocalObjectStorageSync
  ): Promise<void> {
    if (sync.stopped) return;
    sync.stopped = true;

    if (sync.intervalHandle) {
      clearInterval(sync.intervalHandle);
      sync.intervalHandle = null;
    }

    await this.syncWorkspaceToObjectStorage(projectSlug, version, sync, "final");
  }

  private async onStudioExit(options: {
    key: string;
    projectSlug: string;
    version: number;
    objectStorageSync: LocalObjectStorageSync | null;
    code: number | null;
  }): Promise<void> {
    if (options.objectStorageSync) {
      await this.stopObjectStorageSync(
        options.projectSlug,
        options.version,
        options.objectStorageSync
      );
    }

    console.log(
      `[StudioMachine] ${options.projectSlug}/v${options.version} exited with code ${options.code}`
    );
    this.studios.delete(options.key);
  }

  private resolveStudioPackagePath(): string {
    // packages/backend/src/services/studioMachines -> packages/studio
    return path.resolve(__dirname, "../../../../studio");
  }

  private async allocatePort(): Promise<number> {
    for (let i = 0; i < 50; i++) {
      const port = this.nextPort++;
      // Keep nextPort from growing without bound in long-lived dev sessions.
      if (this.nextPort > STUDIO_PORT_START + 5000) {
        this.nextPort = STUDIO_PORT_START;
      }
      // Skip ports that are already taken (e.g. standalone studio already running).
      // This reduces "EADDRINUSE" surprises during connected-mode testing.
      if (await isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error("No available ports to start a local studio machine");
  }

  private async waitForReady(
    proc: ChildProcess,
    port: number,
    timeoutMs: number = Number.parseInt(process.env.STUDIO_MACHINE_START_TIMEOUT_MS || "180000", 10) || 180_000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        throw new Error(
          `Studio process exited before becoming ready (${proc.exitCode !== null ? `exit code: ${proc.exitCode}` : `signal: ${proc.signalCode}`})`,
        );
      }

      try {
        const response = await fetch(`${this.getInternalUrl(port)}/health`, {
          method: "GET",
        });
        if (response.ok) {
          const data = (await response.json()) as { status?: string };
          if (data.status === "ok") return;
        }
      } catch {
        // Not ready yet
      }
      await sleep(500);
    }

    throw new Error(
      `Timed out waiting for studio to become ready (port: ${port}, timeoutMs: ${timeoutMs})`,
    );
  }

  private async ensureStudioBuilt(studioPath: string): Promise<void> {
    const serverEntry = path.join(studioPath, "server", "index.ts");
    if (!fs.existsSync(serverEntry)) {
      throw new Error(
        `Studio sources are missing at ${studioPath} (expected ${serverEntry}). ` +
          `If you're running Docker dev, rebuild the backend image or ensure ./packages/studio is synced into the backend container.`,
      );
    }

    const entry = path.join(studioPath, "dist", "index.js");
    if (fs.existsSync(entry)) return;

    if (!this.studioBuildPromise) {
      this.studioBuildPromise = this.buildStudio(studioPath).finally(() => {
        this.studioBuildPromise = null;
      });
    }

    await this.studioBuildPromise;

    if (!fs.existsSync(entry)) {
      throw new Error("Studio build completed but dist/index.js was not found");
    }
  }

  private async buildStudio(studioPath: string): Promise<void> {
    console.log("[StudioMachine] Building @vivd/studio (missing dist/)...");

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("npm", ["run", "build"], {
        cwd: studioPath,
        env: process.env,
        shell: true,
        stdio: "pipe",
      });

      const recentOutput: string[] = [];
      const recordOutput = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        recentOutput.push(trimmed);
        while (recentOutput.length > 25) recentOutput.shift();
      };

      proc.stdout?.on("data", (data) => {
        const text = data.toString();
        recordOutput(text);
        console.log(`[StudioBuild] ${text.trim()}`);
      });

      proc.stderr?.on("data", (data) => {
        const text = data.toString();
        recordOutput(text);
        console.error(`[StudioBuild] ${text.trim()}`);
      });

      proc.on("error", (err) => {
        reject(err);
      });

      proc.on("exit", (code) => {
        if (code === 0) return resolve();
        const lastLine = recentOutput.at(-1);
        const suffix = lastLine ? `\nLast output: ${lastLine}` : "";
        reject(new Error(`Studio build failed (exit code: ${code})${suffix}`));
      });
    });
  }

  private stopOldestStudio(): void {
    let oldest: StudioProcess | null = null;
    for (const studio of this.studios.values()) {
      if (!oldest || studio.lastActivityAt < oldest.lastActivityAt) {
        oldest = studio;
      }
    }
    if (!oldest) return;
    this.stop(oldest.projectSlug, oldest.version);
  }

  private cleanupIdleStudios(): void {
    const now = Date.now();
    for (const studio of this.studios.values()) {
      if (now - studio.lastActivityAt.getTime() > IDLE_TIMEOUT_MS) {
        console.log(
          `[StudioMachine] Stopping idle local studio for ${studio.projectSlug}/v${studio.version}`
        );
        this.stop(studio.projectSlug, studio.version);
      }
    }
  }
}
