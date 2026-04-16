function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const requireVerifiedRecipients = readBooleanEnv(
  "VIVD_CONTACT_FORM_REQUIRE_VERIFIED_RECIPIENTS",
  true,
);
import {
  DEFAULT_CONTACT_FORM_FIELDS,
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./config";
import type {
  ContactRecipientDirectory,
  ContactRecipientVerificationRequestResult,
} from "./module";
import type {
  ContactFormPluginInstanceRow,
  ContactFormPluginServiceDeps,
} from "./ports";
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
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
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
    inferredAutoSourceHosts: string[];
    turnstileEnabled: boolean;
    turnstileConfigured: boolean;
  };
  recipients: ContactRecipientDirectory;
  instructions: string[];
}

function normalizeContactFormConfig(configJson: unknown): ContactFormPluginConfig {
  const parsed = contactFormPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return contactFormPluginConfigSchema.parse({});
}

function buildUsage(input: {
  submitEndpoint: string;
  config: ContactFormPluginConfig | null;
  inferredAutoSourceHosts: string[];
  turnstileEnabled: boolean;
  turnstileConfigured: boolean;
}) {
  const configuredFields = input.config?.formFields ?? DEFAULT_CONTACT_FORM_FIELDS;
  const optionalFields = ["_redirect", "_subject", "_honeypot"];
  if (input.turnstileEnabled) {
    optionalFields.push("cf-turnstile-response");
  }

  return {
    submitEndpoint: input.submitEndpoint,
    expectedFields: ["token", ...configuredFields.map((field) => field.key)],
    optionalFields,
    inferredAutoSourceHosts: input.inferredAutoSourceHosts,
    turnstileEnabled: input.turnstileEnabled,
    turnstileConfigured: input.turnstileConfigured,
  };
}

export class ContactFormRecipientVerificationError extends Error {
  readonly recipientEmails: string[];

  constructor(recipientEmails: string[]) {
    const joinedRecipients = recipientEmails.join(", ");
    const noun = recipientEmails.length === 1 ? "email is" : "emails are";
    super(
      `Recipient ${noun} not verified for this project: ${joinedRecipients}`,
    );
    this.name = "ContactFormRecipientVerificationError";
    this.recipientEmails = recipientEmails;
  }
}

export class ContactFormRecipientRequiredError extends Error {
  constructor() {
    super("At least one verified recipient email is required");
    this.name = "ContactFormRecipientRequiredError";
  }
}

export class ContactFormPluginNotEnabledError extends Error {
  constructor() {
    super("Contact Form plugin is not enabled for this project");
    this.name = "ContactFormPluginNotEnabledError";
  }
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueValues(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

class ContactFormPluginServiceImpl {
  private readonly deps: ContactFormPluginServiceDeps;

  constructor(deps: ContactFormPluginServiceDeps) {
    this.deps = deps;
  }

  private async assertRecipientEmailsAreVerified(options: {
    organizationId: string;
    projectSlug: string;
    recipientEmails: string[];
  }): Promise<void> {
    if (options.recipientEmails.length === 0) {
      throw new ContactFormRecipientRequiredError();
    }

    const verifiedEmailSet = new Set<string>();
    const verifiedOrganizationEmails =
      await this.deps.listVerifiedOrganizationMemberEmails({
        organizationId: options.organizationId,
      });
    for (const email of verifiedOrganizationEmails) {
      verifiedEmailSet.add(normalizeEmailAddress(email));
    }

    const verifiedExternalEmailSet =
      await this.deps.recipientVerificationService.listVerifiedExternalRecipientEmailSet({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        recipientEmails: options.recipientEmails,
      });

    const normalizedRecipients = options.recipientEmails.map(normalizeEmailAddress);
    const rejectedRecipients = uniqueValues(
      normalizedRecipients.filter(
        (email) =>
          !verifiedEmailSet.has(email) && !verifiedExternalEmailSet.has(email),
      ),
    );
    if (rejectedRecipients.length > 0) {
      throw new ContactFormRecipientVerificationError(rejectedRecipients);
    }
  }

  async ensureContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginPayload> {
    const { row, created } =
      await this.deps.projectPluginInstanceService.ensurePluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });

    return await this.toPayload(row, created);
  }

  async getContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
    ensure?: boolean;
  }): Promise<ContactFormPluginPayload | null> {
    if (options.ensure) {
      return this.ensureContactFormPlugin(options);
    }

    const existing = await this.deps.projectPluginInstanceService.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    if (!existing) return null;
    return await this.toPayload(existing, false);
  }

  async updateContactFormConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: ContactFormPluginConfig;
  }): Promise<ContactFormPluginPayload> {
    const parsedConfig = contactFormPluginConfigSchema.parse(options.config);
    if (requireVerifiedRecipients) {
      await this.assertRecipientEmailsAreVerified({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        recipientEmails: parsedConfig.recipientEmails,
      });
    } else if (parsedConfig.recipientEmails.length === 0) {
      throw new ContactFormRecipientRequiredError();
    }

    const { row } =
      await this.deps.projectPluginInstanceService.ensurePluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });

    const updated =
      await this.deps.projectPluginInstanceService.updatePluginInstance({
        instanceId: row.id,
        configJson: parsedConfig,
        status: "enabled",
        updatedAt: new Date(),
      });

    if (updated) return await this.toPayload(updated, false);

    return await this.toPayload(
      {
        ...row,
        configJson: parsedConfig,
        status: "enabled",
      },
      false,
    );
  }

  async requestRecipientVerification(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
    requestedByUserId?: string | null;
    requestHost?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult> {
    const pluginInstance =
      await this.deps.projectPluginInstanceService.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    if (!pluginInstance || pluginInstance.status !== "enabled") {
      throw new ContactFormPluginNotEnabledError();
    }

    return this.deps.recipientVerificationService.requestRecipientVerification({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginInstanceId: pluginInstance.id,
      email: options.email,
      requestedByUserId: options.requestedByUserId,
      requestHost: options.requestHost,
    });
  }

  async markRecipientVerified(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
    requestedByUserId?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult> {
    const pluginInstance =
      await this.deps.projectPluginInstanceService.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    if (!pluginInstance || pluginInstance.status !== "enabled") {
      throw new ContactFormPluginNotEnabledError();
    }

    return this.deps.recipientVerificationService.markRecipientVerified({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginInstanceId: pluginInstance.id,
      email: options.email,
      requestedByUserId: options.requestedByUserId,
    });
  }

  async getContactFormInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginInfoPayload> {
    const submitEndpoint = await this.deps.getContactFormSubmitEndpoint();
    const inferredAutoSourceHosts = await this.deps.inferSourceHosts({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
    });
    const entitlement = await this.deps.pluginEntitlementService.resolveEffectiveEntitlement({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    const turnstileConfigured =
      entitlement.turnstileEnabled &&
      !!entitlement.turnstileSiteKey &&
      !!entitlement.turnstileSecretKey;
    const entitled = entitlement.state === "enabled";
    const snippetTurnstileSiteKey = turnstileConfigured
      ? entitlement.turnstileSiteKey
      : null;

    const existing = await this.deps.projectPluginInstanceService.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    const normalizedExistingConfig = existing
      ? normalizeContactFormConfig(existing.configJson)
      : null;
    const recipients =
      await this.deps.recipientVerificationService.listRecipientDirectory({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        verifiedRecipientEmails: normalizedExistingConfig?.recipientEmails ?? [],
      });

    if (!existing) {
      return {
        pluginId: "contact_form",
        entitled,
        entitlementState: entitlement.state,
        enabled: false,
        instanceId: null,
        status: null,
        publicToken: null,
        config: null,
        snippets: null,
        usage: buildUsage({
          submitEndpoint,
          config: null,
          inferredAutoSourceHosts,
          turnstileEnabled: entitlement.turnstileEnabled,
          turnstileConfigured,
        }),
        recipients,
        instructions: entitled
          ? [
              "Contact Form access is enabled for this instance, but no plugin instance exists yet for this project.",
              "Enable it in Studio/Control-Plane Plugins UI first (Project → Plugins → Contact Form).",
              "After enabling, run `vivd plugins contact info` again to get the project-specific token, config, and snippets.",
            ]
          : [
              "Contact Form access is currently disabled for this project.",
              "Ask a super-admin to enable Contact Form in the admin plugin settings for this installation.",
              "After access is enabled, run `vivd plugins contact info` again to get install instructions.",
            ],
      };
    }

    if (!entitled) {
      const normalizedConfig =
        normalizedExistingConfig ?? normalizeContactFormConfig(existing.configJson);
      return {
        pluginId: "contact_form",
        entitled,
        entitlementState: entitlement.state,
        enabled: false,
        instanceId: existing.id,
        status: existing.status,
        publicToken: existing.publicToken,
        config: normalizedConfig,
        snippets: getContactFormSnippets(existing.publicToken, submitEndpoint, {
          formFields: normalizedConfig.formFields,
          turnstileSiteKey: snippetTurnstileSiteKey,
        }),
        usage: buildUsage({
          submitEndpoint,
          config: normalizedConfig,
          inferredAutoSourceHosts,
          turnstileEnabled: entitlement.turnstileEnabled,
          turnstileConfigured,
        }),
        recipients,
        instructions: [
          "Contact Form plugin instance exists, but entitlement is not enabled for this project.",
          "Ask a super-admin to enable Contact Form in the admin plugin settings for this installation.",
          "Keep the snippet in place; submissions will resume once entitlement is enabled again.",
        ],
      };
    }

    if (existing.status !== "enabled") {
      const normalizedConfig =
        normalizedExistingConfig ?? normalizeContactFormConfig(existing.configJson);
      return {
        pluginId: "contact_form",
        entitled,
        entitlementState: entitlement.state,
        enabled: false,
        instanceId: existing.id,
        status: existing.status,
        publicToken: existing.publicToken,
        config: normalizedConfig,
        snippets: getContactFormSnippets(existing.publicToken, submitEndpoint, {
          formFields: normalizedConfig.formFields,
          turnstileSiteKey: snippetTurnstileSiteKey,
        }),
        usage: buildUsage({
          submitEndpoint,
          config: normalizedConfig,
          inferredAutoSourceHosts,
          turnstileEnabled: entitlement.turnstileEnabled,
          turnstileConfigured,
        }),
        recipients,
        instructions: [
          "Contact Form plugin instance exists but is currently disabled.",
          "Re-enable it in Studio/Control-Plane Plugins UI first.",
          "After re-enabling, use the provided token/snippet in website markup and verify via test submission.",
        ],
      };
    }

    const normalizedConfig =
      normalizedExistingConfig ?? normalizeContactFormConfig(existing.configJson);
    return {
      pluginId: "contact_form",
      entitled,
      entitlementState: entitlement.state,
      enabled: true,
      instanceId: existing.id,
      status: existing.status,
      publicToken: existing.publicToken,
      config: normalizedConfig,
      snippets: getContactFormSnippets(existing.publicToken, submitEndpoint, {
        formFields: normalizedConfig.formFields,
        turnstileSiteKey: snippetTurnstileSiteKey,
      }),
      usage: buildUsage({
        submitEndpoint,
        config: normalizedConfig,
        inferredAutoSourceHosts,
        turnstileEnabled: entitlement.turnstileEnabled,
        turnstileConfigured,
      }),
      recipients,
      instructions:
        normalizedConfig.recipientEmails.length > 0
          ? [
              "Insert one of the provided snippets into the website contact section (HTML or Astro).",
              "Keep the hidden token input unchanged; it maps submissions to this project plugin instance.",
              `Use form action ${submitEndpoint} with method POST.`,
              "Customize form fields in Project → Plugins (defaults: name, email, message) and keep _honeypot hidden and empty.",
              entitlement.turnstileEnabled
                ? turnstileConfigured
                  ? "Turnstile protection is enabled by super-admin; keep the widget block and script from the snippet."
                  : "Turnstile is enabled by super-admin but still syncing configuration. Snippets include it once ready."
                : "Turnstile protection is currently disabled for this project (can be enabled by super-admin).",
              "If source hosts are empty, Vivd auto-uses project first-party hosts (published + tenant hosts) when available.",
              "Optionally pass _redirect for success redirect; it must match redirect allowlist (or effective source hosts when redirect allowlist is empty).",
              "Verify by submitting once from preview/published domain and checking recipient inbox.",
            ]
          : [
              "Contact Form plugin is enabled, but no recipient email is configured yet.",
              "Add a recipient in Project → Plugins and verify the email before expecting delivery.",
              "Then insert one of the provided snippets and verify with a test submit.",
            ],
    };
  }

  private async toPayload(
    row: ContactFormPluginInstanceRow,
    created: boolean,
  ): Promise<ContactFormPluginPayload> {
    const submitEndpoint = await this.deps.getContactFormSubmitEndpoint();
    const normalizedConfig = normalizeContactFormConfig(row.configJson);
    return {
      pluginId: "contact_form",
      instanceId: row.id,
      status: row.status,
      created,
      publicToken: row.publicToken,
      config: normalizedConfig,
      snippets: getContactFormSnippets(row.publicToken, submitEndpoint, {
        formFields: normalizedConfig.formFields,
      }),
    };
  }
}

export function createContactFormPluginService(
  deps: ContactFormPluginServiceDeps,
) {
  return new ContactFormPluginServiceImpl(deps);
}

export type ContactFormPluginService = ReturnType<
  typeof createContactFormPluginService
>;
