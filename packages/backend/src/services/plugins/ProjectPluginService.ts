import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { projectPluginInstance } from "../../db/schema";
import {
  contactFormPluginConfigSchema,
  getPluginManifest,
  listPluginCatalogEntries,
  type ContactFormPluginConfig,
  type PluginCatalogEntry,
  type PluginId,
} from "./registry";
import { getContactFormSnippets } from "./contactFormSnippets";
import { getContactFormSubmitEndpoint } from "./publicApi";

type ProjectPluginInstanceRow = typeof projectPluginInstance.$inferSelect;

export interface ProjectPluginInstanceSummary {
  instanceId: string;
  pluginId: string;
  status: string;
  publicToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface PluginCatalogForProject {
  project: {
    organizationId: string;
    slug: string;
  };
  available: PluginCatalogEntry[];
  instances: ProjectPluginInstanceSummary[];
}

export interface ContactFormPluginPayload {
  pluginId: "contact_form";
  instanceId: string;
  status: string;
  created: boolean;
  publicToken: string;
  config: ContactFormPluginConfig;
  snippets: {
    html: string;
    astro: string;
  };
}

export interface ContactFormPluginInfoPayload {
  pluginId: "contact_form";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: ContactFormPluginConfig | null;
  snippets: {
    html: string;
    astro: string;
  } | null;
  usage: {
    submitEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
  };
  instructions: string[];
}

function generatePublicToken(): string {
  return `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
}

function toProjectPluginInstanceSummary(
  row: ProjectPluginInstanceRow,
): ProjectPluginInstanceSummary {
  return {
    instanceId: row.id,
    pluginId: row.pluginId,
    status: row.status,
    publicToken: row.publicToken,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeContactFormConfig(configJson: unknown): ContactFormPluginConfig {
  const parsed = contactFormPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return contactFormPluginConfigSchema.parse({});
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

class ProjectPluginService {
  async listCatalogForProject(
    organizationId: string,
    projectSlug: string,
  ): Promise<PluginCatalogForProject> {
    const rows = await db.query.projectPluginInstance.findMany({
      where: and(
        eq(projectPluginInstance.organizationId, organizationId),
        eq(projectPluginInstance.projectSlug, projectSlug),
      ),
      orderBy: [asc(projectPluginInstance.pluginId)],
    });

    return {
      project: {
        organizationId,
        slug: projectSlug,
      },
      available: listPluginCatalogEntries(),
      instances: rows.map(toProjectPluginInstanceSummary),
    };
  }

  async ensureContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginPayload> {
    const { row, created } = await this.ensurePluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });

    return this.toContactFormPayload(row, created);
  }

  async getContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
    ensure?: boolean;
  }): Promise<ContactFormPluginPayload | null> {
    if (options.ensure) {
      return this.ensureContactFormPlugin(options);
    }

    const existing = await this.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    if (!existing) return null;
    return this.toContactFormPayload(existing, false);
  }

  async getContactFormInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginInfoPayload> {
    const submitEndpoint = getContactFormSubmitEndpoint();
    const existing = await this.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });

    if (!existing) {
      return {
        pluginId: "contact_form",
        enabled: false,
        instanceId: null,
        status: null,
        publicToken: null,
        config: null,
        snippets: null,
        usage: {
          submitEndpoint,
          expectedFields: ["token", "name", "email", "message"],
          optionalFields: ["_redirect", "_subject", "_honeypot"],
        },
        instructions: [
          "Contact Form plugin is not enabled for this project yet.",
          "Enable it in Studio/Control-Plane Plugins UI first (Project → Plugins → Contact Form).",
          "After enabling, call vivd_plugins_contact_info again to get project-specific token + snippets.",
        ],
      };
    }

    if (existing.status !== "enabled") {
      return {
        pluginId: "contact_form",
        enabled: false,
        instanceId: existing.id,
        status: existing.status,
        publicToken: existing.publicToken,
        config: normalizeContactFormConfig(existing.configJson),
        snippets: getContactFormSnippets(existing.publicToken, submitEndpoint),
        usage: {
          submitEndpoint,
          expectedFields: ["token", "name", "email", "message"],
          optionalFields: ["_redirect", "_subject", "_honeypot"],
        },
        instructions: [
          "Contact Form plugin instance exists but is currently disabled.",
          "Re-enable it in Studio/Control-Plane Plugins UI first.",
          "After re-enabling, use the provided token/snippet in website markup and verify via test submission.",
        ],
      };
    }

    return {
      pluginId: "contact_form",
      enabled: true,
      instanceId: existing.id,
      status: existing.status,
      publicToken: existing.publicToken,
      config: normalizeContactFormConfig(existing.configJson),
      snippets: getContactFormSnippets(existing.publicToken, submitEndpoint),
      usage: {
        submitEndpoint,
        expectedFields: ["token", "name", "email", "message"],
        optionalFields: ["_redirect", "_subject", "_honeypot"],
      },
      instructions: [
        "Insert one of the provided snippets into the website contact section (HTML or Astro).",
        "Keep the hidden token input unchanged; it maps submissions to this project plugin instance.",
        `Use form action ${submitEndpoint} with method POST.`,
        "Include name, email, and message fields; keep _honeypot hidden and empty.",
        "Optionally pass _redirect for success redirect; it must match allowed hosts in plugin config.",
        "Verify by submitting once from preview/published domain and checking plugin inbox.",
      ],
    };
  }

  private async ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<{ row: ProjectPluginInstanceRow; created: boolean }> {
    const existing = await this.getPluginInstance(options);
    if (existing) {
      if (existing.status === "enabled") {
        return { row: existing, created: false };
      }
      const [updated] = await db
        .update(projectPluginInstance)
        .set({ status: "enabled", updatedAt: new Date() })
        .where(eq(projectPluginInstance.id, existing.id))
        .returning();

      return {
        row: updated ?? existing,
        created: false,
      };
    }

    const manifest = getPluginManifest(options.pluginId);
    const now = new Date();

    try {
      const [created] = await db
        .insert(projectPluginInstance)
        .values({
          id: randomUUID(),
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: options.pluginId,
          status: "enabled",
          configJson: manifest.defaultConfig,
          publicToken: generatePublicToken(),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to create plugin instance");
      }

      return { row: created, created: true };
    } catch (error) {
      if (!isPgUniqueViolation(error)) {
        throw error;
      }
      const afterConflict = await this.getPluginInstance(options);
      if (!afterConflict) throw error;
      return { row: afterConflict, created: false };
    }
  }

  private async getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ProjectPluginInstanceRow | null> {
    return (
      (await db.query.projectPluginInstance.findFirst({
        where: and(
          eq(projectPluginInstance.organizationId, options.organizationId),
          eq(projectPluginInstance.projectSlug, options.projectSlug),
          eq(projectPluginInstance.pluginId, options.pluginId),
        ),
      })) ?? null
    );
  }

  private toContactFormPayload(
    row: ProjectPluginInstanceRow,
    created: boolean,
  ): ContactFormPluginPayload {
    const submitEndpoint = getContactFormSubmitEndpoint();
    return {
      pluginId: "contact_form",
      instanceId: row.id,
      status: row.status,
      created,
      publicToken: row.publicToken,
      config: normalizeContactFormConfig(row.configJson),
      snippets: getContactFormSnippets(row.publicToken, submitEndpoint),
    };
  }
}

export const projectPluginService = new ProjectPluginService();
