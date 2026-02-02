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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface StudioProcess {
  process: ChildProcess;
  port: number;
  studioId: string;
  projectSlug: string;
  version: number;
  lastActivityAt: Date;
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

	    const env: Record<string, string> = {
	      ...process.env,
	      PORT: String(port),
	      REPO_URL: args.repoUrl,
	      BRANCH: args.branch || "main",
	      STUDIO_ID: studioId,
	      VIVD_PROJECT_SLUG: args.projectSlug,
	      VIVD_PROJECT_VERSION: String(args.version),
	      // Avoid cross-studio port collisions in local mode (Fly machines are isolated).
	      DEV_SERVER_PORT_START: String(port + 2000),
	      OPENCODE_PORT_START: String(port + 3000),
	      // Prevent one studio instance from killing another instance's OpenCode processes.
	      OPENCODE_KILL_ORPHANS: "0",
	    };

    if (args.gitToken) {
      env.GIT_TOKEN = args.gitToken;
    }

    for (const [k, v] of Object.entries(args.env)) {
      if (typeof v === "string") env[k] = v;
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
      console.log(
        `[StudioMachine] ${args.projectSlug}/v${args.version} exited with code ${code}`
      );
      this.studios.delete(key);
    });

    this.studios.set(key, {
      process: proc,
      port,
      studioId,
      projectSlug: args.projectSlug,
      version: args.version,
      lastActivityAt: new Date(),
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
