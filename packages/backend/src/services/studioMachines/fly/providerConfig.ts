import crypto from "node:crypto";
import { getPublicUrlForPort } from "./machineInventory";
import {
  parseBooleanEnv,
  parseNonNegativeInt,
  parsePositiveInt,
  sanitizeForFlyAppId,
} from "./utils";

export type FlyProviderGuestConfig = {
  cpu_kind: "shared" | "performance";
  cpus: number;
  memory_mb: number;
};

export class FlyProviderConfig {
  key(organizationId: string, projectSlug: string, version: number): string {
    return `${organizationId}:${projectSlug}:v${version}`;
  }

  machineNameFor(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): string {
    const key = `${organizationId}:${projectSlug}:v${version}`;
    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
    const base = sanitizeForFlyAppId(`studio-${projectSlug}-v${version}`);
    const maxBaseLen = 45 - (hash.length + 1);
    const clippedBase = base.length > maxBaseLen ? base.slice(0, maxBaseLen) : base;
    return `${clippedBase}-${hash}`;
  }

  generateStudioAccessToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  get token(): string {
    const token = process.env.FLY_API_TOKEN;
    if (!token) {
      throw new Error(
        "Missing FLY_API_TOKEN. Create a token with `fly tokens create` and set it in your backend environment.",
      );
    }
    return token;
  }

  get appName(): string {
    const app = process.env.FLY_STUDIO_APP;
    if (!app) {
      throw new Error(
        "Missing FLY_STUDIO_APP (Fly app name to host studio machines). Create one with `fly apps create <name>`.",
      );
    }
    return app;
  }

  get studioImageRepository(): string {
    const configured = process.env.FLY_STUDIO_IMAGE_REPO?.trim();
    if (configured) return configured;
    return "ghcr.io/vivd-studio/vivd-studio";
  }

  get region(): string {
    return process.env.FLY_STUDIO_REGION || process.env.FLY_REGION || "fra";
  }

  get portStart(): number {
    const raw = process.env.FLY_STUDIO_PORT_START || "3100";
    const parsed = Number.parseInt(raw, 10);
    return Math.max(1024, Number.isFinite(parsed) ? parsed : 3100);
  }

  get publicHost(): string {
    return process.env.FLY_STUDIO_PUBLIC_HOST || `${this.appName}.fly.dev`;
  }

  get publicProtocol(): string {
    return process.env.FLY_STUDIO_PUBLIC_PROTOCOL || "https";
  }

  get startTimeoutMs(): number {
    const raw = process.env.STUDIO_MACHINE_START_TIMEOUT_MS || "300000";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 300_000;
  }

  get reconcilerEnabled(): boolean {
    return parseBooleanEnv(process.env.FLY_STUDIO_RECONCILER_ENABLED, true);
  }

  get reconcilerIntervalMs(): number {
    return parseNonNegativeInt(process.env.FLY_STUDIO_RECONCILER_INTERVAL_MS, 600_000);
  }

  get reconcilerDryRun(): boolean {
    return parseBooleanEnv(process.env.FLY_STUDIO_RECONCILER_DRY_RUN, false);
  }

  get warmOutdatedImages(): boolean {
    return parseBooleanEnv(process.env.FLY_STUDIO_RECONCILER_WARM_OUTDATED_IMAGES, true);
  }

  get reconcilerConcurrency(): number {
    return parsePositiveInt(process.env.FLY_STUDIO_RECONCILER_CONCURRENCY, 100);
  }

  get maxMachineInactivityDays(): number {
    const fromNew = process.env.FLY_STUDIO_RECONCILER_MAX_MACHINE_INACTIVITY_DAYS;
    if (typeof fromNew === "string" && fromNew.trim()) {
      return parsePositiveInt(fromNew, 7);
    }
    return parsePositiveInt(process.env.FLY_STUDIO_RECONCILER_MAX_MACHINE_AGE_DAYS, 7);
  }

  get maxMachineInactivityMs(): number {
    return this.maxMachineInactivityDays * 24 * 60 * 60 * 1000;
  }

  // Backwards-compatible aliases for older call sites.
  get maxMachineAgeDays(): number {
    return this.maxMachineInactivityDays;
  }

  get maxMachineAgeMs(): number {
    return this.maxMachineInactivityMs;
  }

  get idleTimeoutMs(): number {
    return parseNonNegativeInt(process.env.FLY_STUDIO_IDLE_TIMEOUT_MS, 600_000);
  }

  get idleCheckIntervalMs(): number {
    return parseNonNegativeInt(
      process.env.FLY_STUDIO_IDLE_CHECK_INTERVAL_MS,
      30_000,
    );
  }

  get cpuKind(): "shared" | "performance" {
    const configured = (process.env.FLY_STUDIO_CPU_KIND || "shared")
      .trim()
      .toLowerCase();
    return configured === "performance" ? "performance" : "shared";
  }

  get cpuCount(): number {
    return parsePositiveInt(process.env.FLY_STUDIO_CPUS, 1);
  }

  get minimumMemoryMb(): number {
    if (this.cpuKind !== "performance") return 256;
    // Fly performance machines should have at least 2 GiB per CPU.
    return this.cpuCount * 2048;
  }

  get memoryMb(): number {
    const configured = parsePositiveInt(process.env.FLY_STUDIO_MEMORY_MB, 1024);
    const minimum = this.minimumMemoryMb;
    if (configured < minimum) {
      console.warn(
        `[FlyMachines] FLY_STUDIO_MEMORY_MB=${configured} too low for cpu_kind=${this.cpuKind}, cpus=${this.cpuCount}; using ${minimum} MiB.`,
      );
      return minimum;
    }
    return configured;
  }

  get desiredGuest(): FlyProviderGuestConfig {
    return {
      cpu_kind: this.cpuKind,
      cpus: this.cpuCount,
      memory_mb: this.memoryMb,
    };
  }

  get desiredKillTimeoutSeconds(): number {
    return parsePositiveInt(process.env.FLY_STUDIO_KILL_TIMEOUT_SECONDS, 180);
  }

  getPublicUrlForPort(port: number): string {
    return getPublicUrlForPort({
      protocol: this.publicProtocol,
      host: this.publicHost,
      port,
    });
  }
}
