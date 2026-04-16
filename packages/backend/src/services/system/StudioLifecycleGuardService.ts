type StudioLifecycleAction = "startStudio" | "hardRestartStudio" | "touchStudio";
type GuardMode = "off" | "shadow" | "enforce";
type BudgetScope = "ip" | "organization" | "project" | "user";

type BudgetSpec = {
  scope: BudgetScope;
  subject: string;
  limit: number;
  windowMs: number;
  envName: string;
};

type GuardDecision = {
  allowed: boolean;
  action: StudioLifecycleAction;
  mode: GuardMode;
  limited: boolean;
  retryAfterSeconds: number;
  triggeredBudget: BudgetSpec | null;
};

type CounterState = {
  count: number;
  resetAt: number;
};

type CounterStore = {
  increment(key: string, windowMs: number, now: number): CounterState;
};

const ONE_MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;
const DEFAULT_GUARD_LOG_THROTTLE_MS = 30_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function readGuardModeEnv(
  value: string | undefined,
  fallback: GuardMode,
): GuardMode {
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

class InMemoryCounterStore implements CounterStore {
  private counters = new Map<string, { count: number; windowStart: number }>();

  increment(key: string, windowMs: number, now: number): CounterState {
    const existing = this.counters.get(key);
    if (!existing || now - existing.windowStart >= windowMs) {
      this.counters.set(key, { count: 1, windowStart: now });
      return { count: 1, resetAt: now + windowMs };
    }

    existing.count += 1;
    this.counters.set(key, existing);
    return {
      count: existing.count,
      resetAt: existing.windowStart + windowMs,
    };
  }
}

type CheckActionOptions = {
  action: StudioLifecycleAction;
  organizationId: string | null;
  projectSlug: string | null;
  requestIp: string | null;
  userId: string | null;
  version: number | null;
  now?: number;
};

export class StudioLifecycleGuardService {
  private readonly counterStore: CounterStore;
  private readonly lastLoggedAtBySignature = new Map<string, number>();

  constructor(counterStore: CounterStore = new InMemoryCounterStore()) {
    this.counterStore = counterStore;
  }

  checkAction(options: CheckActionOptions): GuardDecision {
    const mode = this.getMode();
    if (mode === "off") {
      return {
        allowed: true,
        action: options.action,
        mode,
        limited: false,
        retryAfterSeconds: 0,
        triggeredBudget: null,
      };
    }

    const now = options.now ?? Date.now();
    const budgets = this.getBudgets(options);
    for (const budget of budgets) {
      const key = [
        "studio-lifecycle",
        options.action,
        budget.scope,
        budget.subject,
        formatWindow(budget.windowMs),
      ].join(":");
      const state = this.counterStore.increment(key, budget.windowMs, now);
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
        projectSlug: options.projectSlug,
        requestIp: options.requestIp,
        retryAfterSeconds,
        userId: options.userId,
        version: options.version,
      });
      return {
        allowed,
        action: options.action,
        mode,
        limited: true,
        retryAfterSeconds,
        triggeredBudget: budget,
      };
    }

    return {
      allowed: true,
      action: options.action,
      mode,
      limited: false,
      retryAfterSeconds: 0,
      triggeredBudget: null,
    };
  }

  private getMode(): GuardMode {
    return readGuardModeEnv(
      process.env.VIVD_STUDIO_LIFECYCLE_GUARD_MODE,
      "shadow",
    );
  }

  private getBudgets(options: CheckActionOptions): BudgetSpec[] {
    switch (options.action) {
      case "startStudio":
        return this.compactBudgets([
          options.userId
            ? {
                scope: "user",
                subject: options.userId,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_START_LIMIT_USER_PER_MINUTE",
                  8,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_STUDIO_START_LIMIT_USER_PER_MINUTE",
              }
            : null,
          options.organizationId
            ? {
                scope: "organization",
                subject: options.organizationId,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_START_LIMIT_ORG_PER_MINUTE",
                  40,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_STUDIO_START_LIMIT_ORG_PER_MINUTE",
              }
            : null,
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_START_LIMIT_IP_PER_MINUTE",
                  20,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_STUDIO_START_LIMIT_IP_PER_MINUTE",
              }
            : null,
        ]);
      case "hardRestartStudio":
        return this.compactBudgets([
          options.userId
            ? {
                scope: "user",
                subject: options.userId,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_HARD_RESTART_LIMIT_USER_PER_10_MINUTES",
                  6,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_STUDIO_HARD_RESTART_LIMIT_USER_PER_10_MINUTES",
              }
            : null,
          options.organizationId
            ? {
                scope: "organization",
                subject: options.organizationId,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_HARD_RESTART_LIMIT_ORG_PER_10_MINUTES",
                  30,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_STUDIO_HARD_RESTART_LIMIT_ORG_PER_10_MINUTES",
              }
            : null,
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_HARD_RESTART_LIMIT_IP_PER_10_MINUTES",
                  12,
                ),
                windowMs: TEN_MINUTES_MS,
                envName: "VIVD_STUDIO_HARD_RESTART_LIMIT_IP_PER_10_MINUTES",
              }
            : null,
          options.organizationId && options.projectSlug
            ? {
                scope: "project",
                subject: `${options.organizationId}:${options.projectSlug}:v${options.version ?? "unknown"}`,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_HARD_RESTART_LIMIT_PROJECT_PER_10_MINUTES",
                  12,
                ),
                windowMs: TEN_MINUTES_MS,
                envName:
                  "VIVD_STUDIO_HARD_RESTART_LIMIT_PROJECT_PER_10_MINUTES",
              }
            : null,
        ]);
      case "touchStudio":
        return this.compactBudgets([
          options.userId
            ? {
                scope: "user",
                subject: options.userId,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_TOUCH_LIMIT_USER_PER_MINUTE",
                  240,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_STUDIO_TOUCH_LIMIT_USER_PER_MINUTE",
              }
            : null,
          options.requestIp
            ? {
                scope: "ip",
                subject: options.requestIp,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_TOUCH_LIMIT_IP_PER_MINUTE",
                  480,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_STUDIO_TOUCH_LIMIT_IP_PER_MINUTE",
              }
            : null,
          options.organizationId && options.projectSlug
            ? {
                scope: "project",
                subject: `${options.organizationId}:${options.projectSlug}:v${options.version ?? "unknown"}`,
                limit: readPositiveIntEnv(
                  "VIVD_STUDIO_TOUCH_LIMIT_PROJECT_PER_MINUTE",
                  1_200,
                ),
                windowMs: ONE_MINUTE_MS,
                envName: "VIVD_STUDIO_TOUCH_LIMIT_PROJECT_PER_MINUTE",
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
    action: StudioLifecycleAction;
    allowed: boolean;
    budget: BudgetSpec;
    mode: GuardMode;
    organizationId: string | null;
    projectSlug: string | null;
    requestIp: string | null;
    retryAfterSeconds: number;
    userId: string | null;
    version: number | null;
  }) {
    const signature = [
      options.mode,
      options.action,
      options.budget.scope,
      options.budget.subject,
    ].join("|");
    const now = Date.now();
    const throttleMs = readPositiveIntEnv(
      "VIVD_STUDIO_LIFECYCLE_GUARD_LOG_THROTTLE_MS",
      DEFAULT_GUARD_LOG_THROTTLE_MS,
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
        "[StudioLifecycleGuard]",
        `decision=${decision}`,
        `mode=${options.mode}`,
        `action=${options.action}`,
        `scope=${options.budget.scope}`,
        `limit=${options.budget.limit}`,
        `window=${formatWindow(options.budget.windowMs)}`,
        `retryAfterSeconds=${options.retryAfterSeconds}`,
        `organizationId=${options.organizationId ?? "none"}`,
        `project=${options.projectSlug ?? "none"}`,
        `version=${options.version ?? "none"}`,
        `userId=${options.userId ?? "none"}`,
        `requestIp=${options.requestIp ?? "none"}`,
        `env=${options.budget.envName}`,
      ].join(" "),
    );
  }
}

export const studioLifecycleGuardService = new StudioLifecycleGuardService();
export type { GuardDecision, GuardMode, StudioLifecycleAction };
