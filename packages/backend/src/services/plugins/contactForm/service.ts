import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { projectPluginInstance } from "../../../db/schema";
import {
  projectPluginInstanceService,
  type ProjectPluginInstanceRow,
} from "../core/instanceService";
import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./config";
import { getContactFormSubmitEndpoint } from "./publicApi";
import { getContactFormSnippets } from "./snippets";

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

function normalizeContactFormConfig(configJson: unknown): ContactFormPluginConfig {
  const parsed = contactFormPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return contactFormPluginConfigSchema.parse({});
}

class ContactFormPluginService {
  async ensureContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginPayload> {
    const { row, created } = await projectPluginInstanceService.ensurePluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });

    return this.toPayload(row, created);
  }

  async getContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
    ensure?: boolean;
  }): Promise<ContactFormPluginPayload | null> {
    if (options.ensure) {
      return this.ensureContactFormPlugin(options);
    }

    const existing = await projectPluginInstanceService.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    if (!existing) return null;
    return this.toPayload(existing, false);
  }

  async updateContactFormConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: ContactFormPluginConfig;
  }): Promise<ContactFormPluginPayload> {
    const parsedConfig = contactFormPluginConfigSchema.parse(options.config);
    const { row } = await projectPluginInstanceService.ensurePluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });

    const [updated] = await db
      .update(projectPluginInstance)
      .set({
        configJson: parsedConfig,
        status: "enabled",
        updatedAt: new Date(),
      })
      .where(eq(projectPluginInstance.id, row.id))
      .returning();

    if (updated) return this.toPayload(updated, false);

    return this.toPayload(
      {
        ...row,
        configJson: parsedConfig,
        status: "enabled",
      },
      false,
    );
  }

  async getContactFormInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginInfoPayload> {
    const submitEndpoint = getContactFormSubmitEndpoint();
    const existing = await projectPluginInstanceService.getPluginInstance({
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
      instructions:
        normalizeContactFormConfig(existing.configJson).recipientEmails.length > 0
          ? [
              "Insert one of the provided snippets into the website contact section (HTML or Astro).",
              "Keep the hidden token input unchanged; it maps submissions to this project plugin instance.",
              `Use form action ${submitEndpoint} with method POST.`,
              "Include name, email, and message fields; keep _honeypot hidden and empty.",
              "Optionally pass _redirect for success redirect; it must match allowed hosts in plugin config.",
              "Verify by submitting once from preview/published domain and checking recipient inbox.",
            ]
          : [
              "Contact Form plugin is enabled, but no recipient email is configured yet.",
              "Add at least one recipient email in Project → Plugins before expecting email delivery.",
              "Then insert one of the provided snippets and verify with a test submit.",
            ],
    };
  }

  private toPayload(
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

export const contactFormPluginService = new ContactFormPluginService();
