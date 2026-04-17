import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { contactFormPluginConfigSchema } from "./config";
import {
  DEFAULT_CONTACT_FORM_TURNSTILE_MAX_DOMAINS,
  resolveEffectiveSourceHosts,
  toTurnstileDomains,
} from "./hostUtils";
import type {
  ContactFormTurnstileServiceDeps,
  ContactFormTurnstileWidgetCredentials,
  ContactFormTurnstileVerificationResult,
} from "./ports";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_WIDGET_NAME_PREFIX = "vivd-contact-form";
const DEFAULT_VERIFY_TIMEOUT_MS = 6_000;
const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export type TurnstileWidgetMode = "managed" | "non-interactive" | "invisible";

interface TurnstileAutomationConfig {
  accountId: string;
  apiToken: string;
  widgetNamePrefix: string;
  widgetMode: TurnstileWidgetMode;
  maxDomainsPerWidget: number;
  syncIntervalMs: number;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  messages?: { code?: number; message?: string }[];
  result?: T;
}

interface CloudflareWidgetResult {
  sitekey?: string;
  secret?: string;
  domains?: string[];
}

export type TurnstileVerificationResult = ContactFormTurnstileVerificationResult;

class MissingProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingProjectError";
  }
}

function readEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function getAutomationConfig(): TurnstileAutomationConfig | null {
  const accountId = readEnv("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = readEnv("CLOUDFLARE_API_TOKEN");

  if (!accountId || !apiToken) return null;

  return {
    accountId,
    apiToken,
    widgetNamePrefix: DEFAULT_WIDGET_NAME_PREFIX,
    widgetMode: "managed",
    maxDomainsPerWidget: DEFAULT_CONTACT_FORM_TURNSTILE_MAX_DOMAINS,
    syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
  };
}

function buildAutomationConfigIssue(): string | null {
  const accountId = readEnv("CLOUDFLARE_ACCOUNT_ID");
  if (!accountId) {
    return "Missing Cloudflare account ID (set CLOUDFLARE_ACCOUNT_ID)";
  }

  const apiToken = readEnv("CLOUDFLARE_API_TOKEN");
  if (!apiToken) {
    return "Missing Cloudflare API token (set CLOUDFLARE_API_TOKEN)";
  }

  return null;
}

function sanitizeWidgetSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 40) || "project";
}

function buildWidgetName(config: TurnstileAutomationConfig, options: {
  organizationId: string;
  projectSlug: string;
}): string {
  const prefix = sanitizeWidgetSegment(config.widgetNamePrefix);
  const org = sanitizeWidgetSegment(options.organizationId);
  const project = sanitizeWidgetSegment(options.projectSlug);
  return `${prefix}-${org}-${project}`.slice(0, 254);
}

async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatCloudflareError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const envelope = body as CloudflareEnvelope<unknown>;
    const errorMessage = envelope.errors?.[0]?.message?.trim();
    if (errorMessage) return `Cloudflare API error: ${errorMessage}`;
    if (envelope.success === false) {
      return "Cloudflare API error";
    }
  }

  return `Cloudflare API request failed (status ${status})`;
}

async function cloudflareApiRequest<T>(
  config: TurnstileAutomationConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const jsonBody = await parseJsonBody(response);
  if (!response.ok) {
    throw new Error(formatCloudflareError(response.status, jsonBody));
  }

  const envelope = jsonBody as CloudflareEnvelope<T> | null;
  if (!envelope || envelope.success !== true || envelope.result === undefined) {
    throw new Error(formatCloudflareError(response.status, jsonBody));
  }

  return envelope.result;
}

function normalizeContactFormConfig(rawConfig: unknown) {
  const parsed = contactFormPluginConfigSchema.safeParse(rawConfig ?? {});
  if (parsed.success) return parsed.data;
  return contactFormPluginConfigSchema.parse({});
}

class ContactFormTurnstileServiceImpl {
  private readonly deps: ContactFormTurnstileServiceDeps;

  constructor(deps: ContactFormTurnstileServiceDeps) {
    this.deps = deps;
  }

  getAutomationConfigurationIssue(): string | null {
    return buildAutomationConfigIssue();
  }

  isAutomationConfigured(): boolean {
    return getAutomationConfig() !== null;
  }

  getSyncIntervalMs(): number {
    const config = getAutomationConfig();
    return config?.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  }

  async verifyToken(options: {
    secretKey: string;
    token: string;
    remoteIp: string | null;
  }): Promise<TurnstileVerificationResult> {
    const secretKey = options.secretKey.trim();
    const token = options.token.trim();
    if (!secretKey || !token) {
      return {
        success: false,
        errorCodes: ["missing-input"],
        hostname: null,
        action: null,
        cdata: null,
      };
    }

    const verifyTimeoutMs = DEFAULT_VERIFY_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), verifyTimeoutMs);

    try {
      const payload = new URLSearchParams();
      payload.set("secret", secretKey);
      payload.set("response", token);
      if (options.remoteIp) {
        payload.set("remoteip", options.remoteIp);
      }
      payload.set("idempotency_key", randomUUID());

      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payload.toString(),
        signal: controller.signal,
      });

      const jsonBody = (await parseJsonBody(response)) as
        | {
            success?: boolean;
            hostname?: string;
            action?: string;
            cdata?: string;
            "error-codes"?: string[];
          }
        | null;

      if (!response.ok || !jsonBody || typeof jsonBody !== "object") {
        return {
          success: false,
          errorCodes: ["verification-request-failed"],
          hostname: null,
          action: null,
          cdata: null,
        };
      }

      return {
        success: jsonBody.success === true,
        errorCodes: Array.isArray(jsonBody["error-codes"])
          ? jsonBody["error-codes"].filter((code) => typeof code === "string")
          : [],
        hostname: typeof jsonBody.hostname === "string" ? jsonBody.hostname : null,
        action: typeof jsonBody.action === "string" ? jsonBody.action : null,
        cdata: typeof jsonBody.cdata === "string" ? jsonBody.cdata : null,
      };
    } catch {
      return {
        success: false,
        errorCodes: ["verification-request-failed"],
        hostname: null,
        action: null,
        cdata: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async prepareProjectWidgetCredentials(options: {
    organizationId: string;
    projectSlug: string;
    existingWidgetId?: string | null;
    existingSiteKey?: string | null;
    existingSecretKey?: string | null;
  }): Promise<ContactFormTurnstileWidgetCredentials> {
    const automationConfig = getAutomationConfig();
    if (!automationConfig) {
      throw new Error(
        this.getAutomationConfigurationIssue() || "Turnstile automation is not configured",
      );
    }

    const project = await this.deps.db.query.projectMeta.findFirst({
      where: and(
        eq(this.deps.tables.projectMeta.organizationId, options.organizationId),
        eq(this.deps.tables.projectMeta.slug, options.projectSlug),
      ),
      columns: { slug: true },
    });

    if (!project) {
      throw new MissingProjectError(
        `Project ${options.organizationId}/${options.projectSlug} no longer exists`,
      );
    }

    const pluginInstance = await this.deps.db.query.projectPluginInstance.findFirst({
      where: and(
        eq(this.deps.tables.projectPluginInstance.organizationId, options.organizationId),
        eq(this.deps.tables.projectPluginInstance.projectSlug, options.projectSlug),
        eq(this.deps.tables.projectPluginInstance.pluginId, "contact_form"),
      ),
      columns: {
        configJson: true,
      },
    });

    const pluginConfig = normalizeContactFormConfig(pluginInstance?.configJson);
    const inferredSourceHosts = await this.deps.inferSourceHosts({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
    });
    const effectiveSourceHosts = resolveEffectiveSourceHosts(
      pluginConfig.sourceHosts,
      inferredSourceHosts,
    );
    const domains = toTurnstileDomains(
      effectiveSourceHosts,
      automationConfig.maxDomainsPerWidget,
    );

    if (domains.length === 0) {
      throw new Error(
        "No valid source hosts found for Turnstile. Configure source hosts or publish the project first.",
      );
    }

    const payload = {
      name: buildWidgetName(automationConfig, options),
      domains,
      mode: automationConfig.widgetMode,
    };

    let widgetResult: CloudflareWidgetResult | null = null;
    if (options.existingWidgetId) {
      try {
        widgetResult = await cloudflareApiRequest<CloudflareWidgetResult>(
          automationConfig,
          "PUT",
          `/accounts/${automationConfig.accountId}/challenges/widgets/${options.existingWidgetId}`,
          payload,
        );
      } catch {
        widgetResult = null;
      }
    }

    if (!widgetResult) {
      widgetResult = await cloudflareApiRequest<CloudflareWidgetResult>(
        automationConfig,
        "POST",
        `/accounts/${automationConfig.accountId}/challenges/widgets`,
        payload,
      );
    }

    const siteKey =
      (widgetResult.sitekey || options.existingSiteKey || "").trim();
    let secretKey =
      (widgetResult.secret || options.existingSecretKey || "").trim();

    if (!siteKey) {
      throw new Error("Turnstile API did not return a widget site key");
    }

    if (!secretKey) {
      const rotated = await cloudflareApiRequest<CloudflareWidgetResult>(
        automationConfig,
        "POST",
        `/accounts/${automationConfig.accountId}/challenges/widgets/${siteKey}/rotate_secret`,
        {
          invalidate_immediately: true,
        },
      );
      secretKey = (rotated.secret || "").trim();
    }

    if (!secretKey) {
      throw new Error("Turnstile API did not return a widget secret key");
    }

    return {
      widgetId: siteKey,
      siteKey,
      secretKey,
      domains,
    };
  }

  async deleteWidget(widgetId: string): Promise<void> {
    const widget = widgetId.trim();
    if (!widget) return;

    const automationConfig = getAutomationConfig();
    if (!automationConfig) return;

    try {
      await cloudflareApiRequest<CloudflareWidgetResult>(
        automationConfig,
        "DELETE",
        `/accounts/${automationConfig.accountId}/challenges/widgets/${widget}`,
      );
    } catch (error) {
      console.warn("[ContactFormTurnstile] Failed to delete widget", {
        widgetId: widget,
        error: error instanceof Error ? error : String(error),
      });
    }
  }

  async syncAllProjectEntitlements(): Promise<{
    synced: number;
    cleaned: number;
    failed: number;
  }> {
    const rows = await this.deps.db.query.pluginEntitlement.findMany({
      where: and(
        eq(this.deps.tables.pluginEntitlement.pluginId, "contact_form"),
        eq(this.deps.tables.pluginEntitlement.scope, "project"),
      ),
    });

    let synced = 0;
    let cleaned = 0;
    let failed = 0;

    for (const row of rows) {
      const shouldProtect = row.state === "enabled" && row.turnstileEnabled;

      if (!shouldProtect) {
        if (row.turnstileWidgetId) {
          await this.deleteWidget(row.turnstileWidgetId);
        }
        if (row.turnstileWidgetId || row.turnstileSiteKey || row.turnstileSecretKey) {
          await this.deps.db
            .update(this.deps.tables.pluginEntitlement)
            .set({
              turnstileWidgetId: null,
              turnstileSiteKey: null,
              turnstileSecretKey: null,
              updatedAt: new Date(),
            })
            .where(eq(this.deps.tables.pluginEntitlement.id, row.id));
          cleaned += 1;
        }
        continue;
      }

      try {
        const credentials = await this.prepareProjectWidgetCredentials({
          organizationId: row.organizationId,
          projectSlug: row.projectSlug,
          existingWidgetId: row.turnstileWidgetId,
          existingSiteKey: row.turnstileSiteKey,
          existingSecretKey: row.turnstileSecretKey,
        });

        await this.deps.db
          .update(this.deps.tables.pluginEntitlement)
          .set({
            turnstileWidgetId: credentials.widgetId,
            turnstileSiteKey: credentials.siteKey,
            turnstileSecretKey: credentials.secretKey,
            updatedAt: new Date(),
          })
          .where(eq(this.deps.tables.pluginEntitlement.id, row.id));
        synced += 1;
      } catch (error) {
        if (error instanceof MissingProjectError) {
          if (row.turnstileWidgetId) {
            await this.deleteWidget(row.turnstileWidgetId);
          }
          await this.deps.db
            .update(this.deps.tables.pluginEntitlement)
            .set({
              turnstileWidgetId: null,
              turnstileSiteKey: null,
              turnstileSecretKey: null,
              updatedAt: new Date(),
            })
            .where(eq(this.deps.tables.pluginEntitlement.id, row.id));
          cleaned += 1;
          continue;
        }

        failed += 1;
        console.error("[ContactFormTurnstile] Failed to sync entitlement", {
          entitlementId: row.id,
          organizationId: row.organizationId,
          projectSlug: row.projectSlug,
          error: error instanceof Error ? error : String(error),
        });
      }
    }

    return { synced, cleaned, failed };
  }
}

export function createContactFormTurnstileService(
  deps: ContactFormTurnstileServiceDeps,
) {
  return new ContactFormTurnstileServiceImpl(deps);
}

export type ContactFormTurnstileService = ReturnType<
  typeof createContactFormTurnstileService
>;

export function startContactFormTurnstileSyncJob(
  service: Pick<
    ContactFormTurnstileService,
    "isAutomationConfigured" | "getAutomationConfigurationIssue" | "getSyncIntervalMs" | "syncAllProjectEntitlements"
  >,
): () => void {

  if (!service.isAutomationConfigured()) {
    const issue = service.getAutomationConfigurationIssue();
    if (issue) {
      console.warn(`[ContactFormTurnstile] Sync disabled: ${issue}`);
    }
    return () => {};
  }

  const intervalMs = service.getSyncIntervalMs();
  let running = false;

  const runSync = async () => {
    if (running) return;
    running = true;
    try {
      const result = await service.syncAllProjectEntitlements();
      if (result.synced > 0 || result.cleaned > 0 || result.failed > 0) {
        console.log("[ContactFormTurnstile] Sync completed", result);
      }
    } catch (error) {
      console.error("[ContactFormTurnstile] Sync failed", {
        error: error instanceof Error ? error : String(error),
      });
    } finally {
      running = false;
    }
  };

  void runSync();
  const timer = setInterval(() => {
    void runSync();
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
