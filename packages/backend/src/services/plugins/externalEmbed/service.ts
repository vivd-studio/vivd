import { and, eq } from "drizzle-orm";
import type {
  ExternalEmbedPluginPackageManifest,
  PluginInfoSourcePayload,
} from "@vivd/plugin-sdk";
import { db } from "../../../db";
import { projectPluginInstance } from "../../../db/schema";
import type { PluginId } from "../catalog";
import { pluginEntitlementService } from "../PluginEntitlementService";
import {
  projectPluginInstanceService,
  type ProjectPluginInstanceRow,
} from "../core/instanceService";

type ExternalEmbedPluginId = Extract<PluginId, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasSafeParse(
  value: unknown,
): value is {
  safeParse(input: unknown):
    | { success: true; data: unknown }
    | { success: false; error: unknown };
} {
  return value !== null && typeof value === "object" && "safeParse" in value;
}

function mergeConfigDefaults(
  manifest: ExternalEmbedPluginPackageManifest,
  rawConfig: unknown,
): Record<string, unknown> {
  return {
    ...manifest.definition.defaultConfig,
    ...(isRecord(rawConfig) ? rawConfig : {}),
  };
}

function validateConfig(
  manifest: ExternalEmbedPluginPackageManifest,
  rawConfig: unknown,
): Record<string, unknown> {
  const mergedConfig = mergeConfigDefaults(manifest, rawConfig);
  const schema = manifest.externalEmbed.inputSchema ?? manifest.definition.configSchema;
  if (!hasSafeParse(schema)) {
    return mergedConfig;
  }

  const result = schema.safeParse(mergedConfig);
  if (!result.success) {
    throw ("error" in result ? result.error : new Error("Invalid external embed config"));
  }

  return isRecord(result.data) ? result.data : mergedConfig;
}

function tryValidateConfig(
  manifest: ExternalEmbedPluginPackageManifest,
  rawConfig: unknown,
): Record<string, unknown> | null {
  try {
    return validateConfig(manifest, rawConfig);
  } catch {
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveTemplateValue(
  token: string,
  source: Record<string, unknown>,
): unknown {
  const parts = token.split(".").filter(Boolean);
  let current: unknown = source;

  for (const part of parts) {
    if (!isRecord(current)) {
      return "";
    }
    current = current[part];
  }

  return current ?? "";
}

function renderTemplate(
  template: string,
  source: Record<string, unknown>,
): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, token) =>
    escapeHtml(resolveTemplateValue(token, source)),
  );
}

function renderSnippets(
  manifest: ExternalEmbedPluginPackageManifest,
  config: Record<string, unknown>,
): Record<string, string> | null {
  const entries = Object.entries(manifest.externalEmbed.snippetTemplates ?? {}).flatMap(
    ([format, template]) =>
      template
        ? [[format, renderTemplate(template, {
            config,
            plugin: manifest.definition,
            provider: manifest.externalEmbed.provider,
          })] as const]
        : [],
  );

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function buildInstructions(options: {
  manifest: ExternalEmbedPluginPackageManifest;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  renderReady: boolean;
}): string[] {
  const { manifest } = options;
  const instructions = new Set<string>();

  if (!options.enabled) {
    if (options.entitlementState === "enabled") {
      instructions.add(
        `Enable ${manifest.definition.name} for this project before saving config or generating snippets.`,
      );
    } else if (options.entitlementState === "suspended") {
      instructions.add(
        `${manifest.definition.name} is suspended for this project. Re-enable entitlement to use the embed again.`,
      );
    } else {
      instructions.add(
        `${manifest.definition.name} is managed at the instance level. Ask a super-admin to enable it first.`,
      );
    }
  } else if (!options.renderReady) {
    instructions.add("Complete the config JSON with a valid provider embed URL, then save.");
  } else {
    instructions.add("Paste one generated snippet into the published page where the embed should appear.");
  }

  if (manifest.setup?.summary) {
    instructions.add(manifest.setup.summary);
  }
  for (const line of manifest.setup?.instructions ?? []) {
    instructions.add(line);
  }

  return [...instructions];
}

function buildDetails(options: {
  manifest: ExternalEmbedPluginPackageManifest;
  renderReady: boolean;
}): Record<string, unknown> {
  const { manifest } = options;
  return {
    provider: manifest.externalEmbed.provider,
    renderMode: manifest.externalEmbed.renderMode,
    placement: manifest.externalEmbed.placement,
    security: manifest.externalEmbed.security,
    validationRules: manifest.externalEmbed.validationRules ?? [],
    publishChecks: manifest.publishChecks ?? [],
    previewSupport: manifest.previewSupport ?? null,
    renderReady: options.renderReady,
  };
}

function toInfoPayload(options: {
  manifest: ExternalEmbedPluginPackageManifest;
  entitlementState: "disabled" | "enabled" | "suspended";
  row: ProjectPluginInstanceRow | null;
}): PluginInfoSourcePayload {
  const { manifest, entitlementState, row } = options;
  const enabled = entitlementState === "enabled" && row?.status === "enabled";
  const normalizedConfig = mergeConfigDefaults(
    manifest,
    row?.configJson ?? manifest.definition.defaultConfig,
  );
  const validConfig = enabled ? tryValidateConfig(manifest, normalizedConfig) : null;

  return {
    entitled: entitlementState === "enabled",
    entitlementState,
    enabled,
    instanceId: row?.id ?? null,
    status: row?.status ?? null,
    publicToken: row?.publicToken ?? null,
    config: row ? normalizedConfig : null,
    snippets: validConfig ? renderSnippets(manifest, validConfig) : null,
    usage: enabled
      ? {
          provider: manifest.externalEmbed.provider.provider,
          renderMode: manifest.externalEmbed.renderMode,
          preferredPlacement:
            manifest.externalEmbed.placement.preferredTarget ??
            manifest.externalEmbed.placement.targets[0] ??
            null,
          renderReady: Boolean(validConfig),
        }
      : null,
    details: buildDetails({
      manifest,
      renderReady: Boolean(validConfig),
    }),
    instructions: buildInstructions({
      manifest,
      entitlementState,
      enabled,
      renderReady: Boolean(validConfig),
    }),
  };
}

export class ExternalEmbedPluginNotEnabledError extends Error {
  constructor(pluginId: string) {
    super(`Plugin ${pluginId} is not enabled for this project`);
    this.name = "ExternalEmbedPluginNotEnabledError";
  }
}

class ExternalEmbedPluginService {
  async ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    manifest: ExternalEmbedPluginPackageManifest<ExternalEmbedPluginId>;
  }): Promise<{ instanceId: string; created: boolean; status: string }> {
    const ensured = await projectPluginInstanceService.ensurePluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: options.manifest.pluginId,
    });

    return {
      instanceId: ensured.row.id,
      created: ensured.created,
      status: ensured.row.status,
    };
  }

  async getInfoPayload(options: {
    organizationId: string;
    projectSlug: string;
    manifest: ExternalEmbedPluginPackageManifest<ExternalEmbedPluginId>;
  }): Promise<PluginInfoSourcePayload> {
    const [row, entitlement] = await Promise.all([
      projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: options.manifest.pluginId,
      }),
      pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: options.manifest.pluginId,
      }),
    ]);

    return toInfoPayload({
      manifest: options.manifest,
      entitlementState: entitlement.state,
      row,
    });
  }

  async updateConfig(options: {
    organizationId: string;
    projectSlug: string;
    manifest: ExternalEmbedPluginPackageManifest<ExternalEmbedPluginId>;
    config: Record<string, unknown>;
  }): Promise<PluginInfoSourcePayload> {
    const [row, entitlement] = await Promise.all([
      projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: options.manifest.pluginId,
      }),
      pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: options.manifest.pluginId,
      }),
    ]);

    if (!row || row.status !== "enabled" || entitlement.state !== "enabled") {
      throw new ExternalEmbedPluginNotEnabledError(options.manifest.pluginId);
    }

    const parsedConfig = validateConfig(options.manifest, options.config);

    const [updated] = await db
      .update(projectPluginInstance)
      .set({
        configJson: parsedConfig,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectPluginInstance.organizationId, options.organizationId),
          eq(projectPluginInstance.projectSlug, options.projectSlug),
          eq(projectPluginInstance.pluginId, options.manifest.pluginId),
        ),
      )
      .returning();

    return toInfoPayload({
      manifest: options.manifest,
      entitlementState: entitlement.state,
      row: updated ?? {
        ...row,
        configJson: parsedConfig,
        updatedAt: new Date(),
      },
    });
  }
}

export const externalEmbedPluginService = new ExternalEmbedPluginService();
