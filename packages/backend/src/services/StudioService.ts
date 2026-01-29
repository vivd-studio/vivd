import { spawn, ChildProcess } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";
import treeKill from "tree-kill";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface StudioProcess {
  process: ChildProcess;
  port: number;
  projectSlug: string;
  version: number;
  startedAt: Date;
}

const STUDIO_PORT_START = 3100;
const MAX_STUDIOS = 3;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Service to manage studio server instances.
 * Each project/version gets its own studio server.
 */
class StudioService {
  private studios = new Map<string, StudioProcess>();
  private nextPort = STUDIO_PORT_START;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleStudios();
    }, 60 * 1000);
  }

  private getKey(projectSlug: string, version: number): string {
    return `${projectSlug}:${version}`;
  }

  /**
   * Start a studio server for a project version.
   */
  async start(
    projectSlug: string,
    version: number,
    repoUrl: string,
    gitToken?: string
  ): Promise<{ url: string; port: number }> {
    const key = this.getKey(projectSlug, version);

    // Return existing studio if running
    const existing = this.studios.get(key);
    if (existing) {
      existing.startedAt = new Date(); // Update activity
      return { url: `http://localhost:${existing.port}`, port: existing.port };
    }

    // Enforce maximum limit
    if (this.studios.size >= MAX_STUDIOS) {
      console.log(
        `[Studio] At max limit (${MAX_STUDIOS}), stopping oldest studio...`
      );
      this.stopOldestStudio();
    }

    const port = this.nextPort++;
    console.log(
      `[Studio] Starting studio for ${projectSlug}/v${version} on port ${port}`
    );

    // Path to studio package
    const studioPath = path.resolve(__dirname, "../../../studio");

    const env: Record<string, string> = {
      ...process.env,
      PORT: String(port),
      REPO_URL: repoUrl,
      BRANCH: "main",
    };

    if (gitToken) {
      env.GIT_TOKEN = gitToken;
    }

    const proc = spawn("npm", ["run", "start"], {
      cwd: studioPath,
      env,
      shell: true,
      stdio: "pipe",
    });

    proc.stdout?.on("data", (data) => {
      console.log(`[Studio ${projectSlug}] ${data.toString().trim()}`);
    });

    proc.stderr?.on("data", (data) => {
      console.error(`[Studio ${projectSlug}] ${data.toString().trim()}`);
    });

    proc.on("exit", (code) => {
      console.log(`[Studio] ${projectSlug}/v${version} exited with code ${code}`);
      this.studios.delete(key);
    });

    this.studios.set(key, {
      process: proc,
      port,
      projectSlug,
      version,
      startedAt: new Date(),
    });

    // Wait for server to be ready
    await this.waitForReady(port);

    return { url: `http://localhost:${port}`, port };
  }

  /**
   * Wait for studio server to be ready.
   */
  private async waitForReady(
    port: number,
    timeout: number = 30000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(`http://localhost:${port}/health`, {
          method: "GET",
        });
        if (response.ok) {
          const data = (await response.json()) as { status: string };
          if (data.status === "ok") {
            return;
          }
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Even if health check fails, the server might still be starting
    // Just return and let the client handle it
    console.log(`[Studio] Server on port ${port} may still be starting...`);
  }

  /**
   * Stop a studio server.
   */
  stop(projectSlug: string, version: number): void {
    const key = this.getKey(projectSlug, version);
    const studio = this.studios.get(key);

    if (studio) {
      console.log(`[Studio] Stopping studio for ${projectSlug}/v${version}`);
      if (studio.process.pid) {
        treeKill(studio.process.pid, "SIGTERM");
      }
      this.studios.delete(key);
    }
  }

  /**
   * Get studio URL if running.
   */
  getUrl(projectSlug: string, version: number): string | null {
    const key = this.getKey(projectSlug, version);
    const studio = this.studios.get(key);

    if (studio) {
      studio.startedAt = new Date(); // Update activity
      return `http://localhost:${studio.port}`;
    }

    return null;
  }

  /**
   * Check if a studio is running.
   */
  isRunning(projectSlug: string, version: number): boolean {
    return this.studios.has(this.getKey(projectSlug, version));
  }

  /**
   * Stop the oldest studio.
   */
  private stopOldestStudio(): void {
    let oldest: StudioProcess | null = null;
    let oldestKey: string | null = null;

    for (const [key, studio] of this.studios.entries()) {
      if (!oldest || studio.startedAt < oldest.startedAt) {
        oldest = studio;
        oldestKey = key;
      }
    }

    if (oldestKey && oldest) {
      console.log(
        `[Studio] Evicting ${oldest.projectSlug}/v${oldest.version}`
      );
      this.stop(oldest.projectSlug, oldest.version);
    }
  }

  /**
   * Stop idle studios.
   */
  private cleanupIdleStudios(): void {
    const now = Date.now();

    for (const [key, studio] of this.studios.entries()) {
      if (now - studio.startedAt.getTime() > IDLE_TIMEOUT_MS) {
        console.log(
          `[Studio] Stopping idle studio for ${studio.projectSlug}/v${studio.version}`
        );
        this.stop(studio.projectSlug, studio.version);
      }
    }
  }

  /**
   * Stop all studios.
   */
  stopAll(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log(`[Studio] Stopping ${this.studios.size} studio(s)...`);
    for (const studio of this.studios.values()) {
      if (studio.process.pid) {
        treeKill(studio.process.pid, "SIGTERM");
      }
    }
    this.studios.clear();
  }

  /**
   * Get the number of running studios.
   */
  get count(): number {
    return this.studios.size;
  }
}

// Singleton instance
export const studioService = new StudioService();

// Cleanup on process exit
process.on("exit", () => {
  studioService.stopAll();
});

process.on("SIGINT", () => {
  studioService.stopAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  studioService.stopAll();
  process.exit(0);
});
