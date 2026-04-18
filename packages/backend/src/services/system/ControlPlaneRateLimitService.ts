import {
  InMemoryLimiterStore,
  type LimiterStore,
} from "./LimiterStore";

type ControlPlaneRateLimitAction =
  | "auth_mutation"
  | "auth_sign_in"
  | "auth_sign_up"
  | "auth_password_reset"
  | "auth_verification"
  | "project_generation"
  | "project_publish"
  | "zip_import";
type RateLimitMode = "off" | "shadow" | "enforce";
type RateLimitScope = "ip" | "organization" | "user";

type BudgetSpec = {
  scope: RateLimitScope;
  subject: string;
  limit: number;
  windowMs: number;
  envName: string;
};

type RateLimitDecision = {
  action: ControlPlaneRateLimitAction;
  allowed: boolean;
  limited: boolean;
  mode: RateLimitMode;
  retryAfterSeconds: number;
  triggeredBudget: BudgetSpec | null;
};

type CheckRateLimitOptions = {
  action: ControlPlaneRateLimitAction;
  organizationId: string | null;
  requestIp: string | null;
  requestPath?: string | null;
  userId: string | null;
  now?: number;
};

const ONE_MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;
const DEFAULT_LOG_THROTTLE_MS = 30_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function readModeEnv(value: string | undefined, fallback: RateLimitMode): RateLimitMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "shadow" || normalized === "enforce") {
    return normalized;
  }
  return fallback;
}

function formatWindow(windowMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  if (totalSeconds % 3600 === 0) return `${totalSeconds / 3600}h`;
  if (totalSeconds % 60 === 0) return `${totalSeconds / 60}m`;
  return `${totalSeconds}s`;
}

export class ControlPlaneRateLimitService {
  private readonly store: LimiterStore;
  private readonly lastLoggedAtBySignature = new Map<string, number>();

  constructor(store: LimiterStore = new InMemoryLimiterStore()) {
    this.store = store;
  }

  async checkAction(options: CheckRateLimitOptions): Promise<RateLimitDecision> {
    const mode = this.getMode(options.action);
    if (mode === "off") {
      return {
        action: options.action,
        allowed: true,
        limited: false,
        mode,
        retryAfterSeconds: 0,
        triggeredBudget: null,
      };
    }

    const now = options.now ?? Date.now();
    const budgets = this.getBudgets(options);
    for (const budget of budgets) {
      const key = [
        "control-plane",
        options.action,
        budget.scope,
        budget.subject,
        formatWindow(budget.windowMs),
      ].join(":");
      const state = await this.store.incrementFixedWindow({
        key,
        windowMs: budget.windowMs,
        now,
      });
      if (state.count <= budget.limit) continue;

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.resetAt - now) / 1000),
      );
      const allowed = mode !== "enforce";
      this.logLimitEvent({
        action: options.action,
        allowed,
        budget,
        mode,
        organizationId: options.organizationId,
        requestIp: options.requestIp,
        requestPath: options.requestPath,
        retryAfterSeconds,
        userId: options.userId,
      });
      return {
        action: options.action,
        allowed,
        limited: true,
        mode,
        retryAfterSeconds,
        triggeredBudget: budget,
      };
    }

    return {
      action: options.action,
      allowed: true,
      limited: false,
      mode,
      retryAfterSeconds: 0,
      triggeredBudget: null,
    };
  }

  private getMode(action: ControlPlaneRateLimitAction): RateLimitMode {
    const specificEnvName = `VIVD_CONTROL_PLANE_RATE_LIMIT_${action.toUpperCase()}_MODE`;
    if (process.env[specificEnvName]) {
      return readModeEnv(
        process.env[specificEnvName],
        this.getDefaultMode(action),
      );
    }

    return readModeEnv(
      process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_MODE,
      this.getDefaultMode(action),
    );
  }

  private getDefaultMode(action: ControlPlaneRateLimitAction): RateLimitMode {
    switch (action) {
      case "auth_sign_in":
      case "auth_sign_up":
      case "zip_import":
        return "enforce";
      default:
        return "shadow";
    }
  }

  private getBudgets(options: CheckRateLimitOptions): BudgetSpec[] {
    switch (options.action) {
      case "auth_sign_in":
        return this.compactBudgets([
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_AUTH_SIGN_IN_RATE_LIMIT_IP_PER_MINUTE",
                  20,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_AUTH_SIGN_IN_RATE_LIMIT_IP_PER_MINUTE",
              }
            : null,
        ]);
      case "auth_sign_up":
        return this.compactBudgets([
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_AUTH_SIGN_UP_RATE_LIMIT_IP_PER_10_MINUTES",
                  10,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_AUTH_SIGN_UP_RATE_LIMIT_IP_PER_10_MINUTES",
              }
            : null,
        ]);
      case "auth_password_reset":
        return this.compactBudgets([
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_AUTH_PASSWORD_RESET_RATE_LIMIT_IP_PER_10_MINUTES",
                  12,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_AUTH_PASSWORD_RESET_RATE_LIMIT_IP_PER_10_MINUTES",
              }
            : null,
        ]);
      case "auth_verification":
        return this.compactBudgets([
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_AUTH_VERIFICATION_RATE_LIMIT_IP_PER_10_MINUTES",
                  20,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_AUTH_VERIFICATION_RATE_LIMIT_IP_PER_10_MINUTES",
              }
            : null,
        ]);
      case "auth_mutation":
        return this.compactBudgets([
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_AUTH_MUTATION_RATE_LIMIT_IP_PER_MINUTE",
                  60,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_AUTH_MUTATION_RATE_LIMIT_IP_PER_MINUTE",
              }
            : null,
        ]);
      case "project_generation":
        return this.compactBudgets([
          options.userId
            ? {
                scope: "user",
                subject: options.userId,
                limit: readPositiveIntEnv(
                  "VIVD_PROJECT_GENERATION_RATE_LIMIT_USER_PER_10_MINUTES",
                  12,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_PROJECT_GENERATION_RATE_LIMIT_USER_PER_10_MINUTES",
              }
            : null,
          options.organizationId
            ? {
                scope: "organization",
                subject: options.organizationId,
                limit: readPositiveIntEnv(
                  "VIVD_PROJECT_GENERATION_RATE_LIMIT_ORG_PER_10_MINUTES",
                  30,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_PROJECT_GENERATION_RATE_LIMIT_ORG_PER_10_MINUTES",
              }
            : null,
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_PROJECT_GENERATION_RATE_LIMIT_IP_PER_10_MINUTES",
                  20,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_PROJECT_GENERATION_RATE_LIMIT_IP_PER_10_MINUTES",
              }
            : null,
        ]);
      case "project_publish":
        return this.compactBudgets([
          options.userId
            ? {
                scope: "user",
                subject: options.userId,
                limit: readPositiveIntEnv(
                  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_USER_PER_10_MINUTES",
                  30,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_USER_PER_10_MINUTES",
              }
            : null,
          options.organizationId
            ? {
                scope: "organization",
                subject: options.organizationId,
                limit: readPositiveIntEnv(
                  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_ORG_PER_10_MINUTES",
                  80,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_ORG_PER_10_MINUTES",
              }
            : null,
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_IP_PER_10_MINUTES",
                  40,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_PROJECT_PUBLISH_RATE_LIMIT_IP_PER_10_MINUTES",
              }
            : null,
        ]);
      case "zip_import":
        return this.compactBudgets([
          options.userId
            ? {
                scope: "user",
                subject: options.userId,
                limit: readPositiveIntEnv(
                  "VIVD_ZIP_IMPORT_RATE_LIMIT_USER_PER_10_MINUTES",
                  6,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_ZIP_IMPORT_RATE_LIMIT_USER_PER_10_MINUTES",
              }
            : null,
          options.organizationId
            ? {
                scope: "organization",
                subject: options.organizationId,
                limit: readPositiveIntEnv(
                  "VIVD_ZIP_IMPORT_RATE_LIMIT_ORG_PER_10_MINUTES",
                  20,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_ZIP_IMPORT_RATE_LIMIT_ORG_PER_10_MINUTES",
              }
            : null,
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_ZIP_IMPORT_RATE_LIMIT_IP_PER_10_MINUTES",
                  10,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_ZIP_IMPORT_RATE_LIMIT_IP_PER_10_MINUTES",
              }
            : null,
        ]);
    }
  }

  private compactBudgets(
    budgets: Array<BudgetSpec | null>,
  ): BudgetSpec[] {
    return budgets.filter((budget): budget is BudgetSpec => {
      return Boolean(budget && budget.limit > 0 && budget.subject.trim());
    });
  }

  private logLimitEvent(options: {
    action: ControlPlaneRateLimitAction;
    allowed: boolean;
    budget: BudgetSpec;
    mode: RateLimitMode;
    organizationId: string | null;
    requestIp: string | null;
    requestPath?: string | null;
    retryAfterSeconds: number;
    userId: string | null;
  }) {
    const signature = [
      options.mode,
      options.action,
      options.budget.scope,
      options.budget.subject,
    ].join("|");
    const now = Date.now();
    const throttleMs = readPositiveIntEnv(
      "VIVD_CONTROL_PLANE_RATE_LIMIT_LOG_THROTTLE_MS",
      DEFAULT_LOG_THROTTLE_MS,
    );
    const lastLoggedAt = this.lastLoggedAtBySignature.get(signature) ?? 0;
    if (throttleMs > 0 && now - lastLoggedAt < throttleMs) return;

    this.lastLoggedAtBySignature.set(signature, now);
    if (this.lastLoggedAtBySignature.size > 500) {
      const oldestKey = this.lastLoggedAtBySignature.keys().next().value;
      if (oldestKey) this.lastLoggedAtBySignature.delete(oldestKey);
    }

    const decision = options.allowed ? "shadow-allow" : "blocked";
    console.warn(
      [
        "[ControlPlaneRateLimit]",
        `decision=${decision}`,
        `mode=${options.mode}`,
        `action=${options.action}`,
        `scope=${options.budget.scope}`,
        `limit=${options.budget.limit}`,
        `window=${formatWindow(options.budget.windowMs)}`,
        `retryAfterSeconds=${options.retryAfterSeconds}`,
        `organizationId=${options.organizationId ?? "none"}`,
        `userId=${options.userId ?? "none"}`,
        `requestIp=${options.requestIp ?? "none"}`,
        `requestPath=${options.requestPath ?? "none"}`,
        `env=${options.budget.envName}`,
      ].join(" "),
    );
  }
}

export const controlPlaneRateLimitService = new ControlPlaneRateLimitService();
export type { ControlPlaneRateLimitAction, RateLimitDecision, RateLimitMode };
