import { and, eq } from "drizzle-orm";
import type {
  BackendHostContext,
  NativePluginBackendPackage,
} from "@vivd/plugin-sdk";
import { contactFormPluginManifest } from "../manifest";
import type {
  ContactFormPluginBackendContribution,
} from "./contribution";
import { createContactFormPluginBackendContribution } from "./contribution";
import { contactFormPluginDefinition } from "./module";
import type { ContactFormPluginBackendContributionDeps } from "./ports";
import {
  ContactRecipientVerificationEndpointUnavailableError,
  buildContactFormSubmitEndpoint,
  buildContactRecipientVerificationEndpoint,
} from "./publicApi";
import { createContactFormRecipientVerificationService } from "./recipientVerification";
import { inferContactFormAutoSourceHosts } from "./sourceHosts";
import { createContactFormTurnstileService } from "./turnstile";

export const PLATFORM_STUDIO_PREVIEW_HOST = "vivd-studio-prod.fly.dev";

export async function inferVivdContactFormSourceHosts(
  hostContext: BackendHostContext,
  options: {
    organizationId: string;
    projectSlug: string;
  },
): Promise<string[]> {
  const [hosts, installProfile] = await Promise.all([
    inferContactFormAutoSourceHosts(options, {
      async listPublishedSiteDomains(hostOptions) {
        const rows = await hostContext.db.query.publishedSite.findMany({
          where: and(
            eq(
              hostContext.tables.publishedSite.organizationId,
              hostOptions.organizationId,
            ),
            eq(
              hostContext.tables.publishedSite.projectSlug,
              hostOptions.projectSlug,
            ),
          ),
          columns: {
            domain: true,
          },
        });

        return rows.map((row: { domain: string }) => row.domain);
      },
      async listTenantHostDomains(hostOptions) {
        const rows = await hostContext.db.query.domain.findMany({
          where: and(
            eq(
              hostContext.tables.domain.organizationId,
              hostOptions.organizationId,
            ),
            eq(hostContext.tables.domain.usage, "tenant_host"),
            eq(hostContext.tables.domain.status, "active"),
          ),
          columns: {
            domain: true,
          },
        });

        return rows.map((row: { domain: string }) => row.domain);
      },
      nodeEnv: hostContext.runtime.env.nodeEnv,
      flyStudioPublicHost: hostContext.runtime.env.flyStudioPublicHost,
      flyStudioApp: hostContext.runtime.env.flyStudioApp,
    }),
    hostContext.system.installProfileService.getInstallProfile(),
  ]);

  if (installProfile !== "platform") {
    return hosts;
  }

  return Array.from(new Set([...hosts, PLATFORM_STUDIO_PREVIEW_HOST])).sort();
}

function getVivdContactRecipientVerificationEndpoint(
  hostContext: BackendHostContext,
  options?: {
    requestHost?: string | null;
  },
): string {
  const controlPlaneOrigin = hostContext.runtime.getControlPlaneOrigin(options);
  if (controlPlaneOrigin) {
    return buildContactRecipientVerificationEndpoint(controlPlaneOrigin);
  }

  throw new ContactRecipientVerificationEndpointUnavailableError();
}

function createContactFormHostContribution(
  hostContext: BackendHostContext,
): ContactFormPluginBackendContribution {
  const inferSourceHosts = (options: {
    organizationId: string;
    projectSlug: string;
  }) => inferVivdContactFormSourceHosts(hostContext, options);

  const turnstileService = createContactFormTurnstileService({
    db: hostContext.db,
    tables: {
      pluginEntitlement: hostContext.tables.pluginEntitlement,
      projectMeta: hostContext.tables.projectMeta,
      projectPluginInstance: hostContext.tables.projectPluginInstance,
    },
    inferSourceHosts,
  });

  const recipientVerificationService =
    createContactFormRecipientVerificationService({
      db: hostContext.db,
      tables: {
        contactFormRecipientVerification:
          hostContext.tables.contactFormRecipientVerification,
        organizationMember: hostContext.tables.organizationMember,
        projectPluginInstance: hostContext.tables.projectPluginInstance,
      },
      getContactRecipientVerificationEndpoint: (options) =>
        getVivdContactRecipientVerificationEndpoint(hostContext, options),
      buildRecipientVerificationEmail: (...args) =>
        hostContext.email.templates.buildContactRecipientVerificationEmail!(
          ...args
        ),
      emailDeliveryService: hostContext.email.deliveryService,
    });

  return createContactFormPluginBackendContribution({
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return hostContext.projectPluginInstanceService.ensurePluginInstance({
          ...options,
          defaultConfig: contactFormPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(options) {
        return hostContext.projectPluginInstanceService.getPluginInstance(options);
      },
      updatePluginInstance(options) {
        return hostContext.projectPluginInstanceService.updatePluginInstance(options);
      },
    },
    pluginEntitlementService: hostContext.pluginEntitlementService,
    recipientVerificationService,
    turnstileService,
    getContactFormSubmitEndpoint: async (options) =>
      buildContactFormSubmitEndpoint(
        await hostContext.runtime.getPublicPluginApiBaseUrl(options),
      ),
    inferSourceHosts,
    emailDeliverabilityService: hostContext.email.deliverabilityService,
    emailDeliveryService: hostContext.email.deliveryService,
    buildContactSubmissionEmail: (...args) =>
      hostContext.email.templates.buildContactSubmissionEmail!(...args),
    isSesFeedbackAutoConfirmEnabled:
      hostContext.email.isSesFeedbackAutoConfirmEnabled ?? (() => false),
    db: hostContext.db,
    tables: {
      contactFormRecipientVerification:
        hostContext.tables.contactFormRecipientVerification,
      contactFormSubmission: hostContext.tables.contactFormSubmission,
      pluginEntitlement: hostContext.tables.pluginEntitlement,
      projectMeta: hostContext.tables.projectMeta,
      projectPluginInstance: hostContext.tables.projectPluginInstance,
      organizationMember: hostContext.tables.organizationMember,
    },
    async listVerifiedOrganizationMemberEmails(options) {
      const members = await hostContext.db.query.organizationMember.findMany({
        where: eq(
          hostContext.tables.organizationMember.organizationId,
          options.organizationId,
        ),
        with: {
          user: {
            columns: {
              email: true,
              emailVerified: true,
            },
          },
        },
      });

      return members
        .filter((member: { user: { emailVerified: boolean } }) => member.user.emailVerified)
        .map((member: { user: { email: string } }) => member.user.email);
    },
    async syncProjectTurnstileWidget(options) {
      const entitlement =
        await hostContext.pluginEntitlementService.getProjectEntitlementRow({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: "contact_form",
        });
      if (!entitlement) return;
      if (entitlement.state !== "enabled" || entitlement.turnstileEnabled !== true) {
        return;
      }

      const credentials = await turnstileService.prepareProjectWidgetCredentials({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        existingWidgetId: entitlement.turnstileWidgetId ?? null,
        existingSiteKey: entitlement.turnstileSiteKey ?? null,
        existingSecretKey: entitlement.turnstileSecretKey ?? null,
      });

      await hostContext.pluginEntitlementService.upsertEntitlement({
        organizationId: options.organizationId,
        scope: "project",
        projectSlug: options.projectSlug,
        pluginId: "contact_form",
        state: entitlement.state as "enabled" | "disabled" | "suspended",
        managedBy: entitlement.managedBy as
          | "manual_superadmin"
          | "plan"
          | "self_serve",
        monthlyEventLimit: entitlement.monthlyEventLimit,
        hardStop: entitlement.hardStop,
        turnstileEnabled: entitlement.turnstileEnabled,
        turnstileWidgetId: credentials.widgetId,
        turnstileSiteKey: credentials.siteKey,
        turnstileSecretKey: credentials.secretKey,
        notes: entitlement.notes,
        changedByUserId: entitlement.changedByUserId,
      });
    },
  });
}

export const contactFormBackendPluginPackage = {
  ...contactFormPluginManifest,
  backend: {
    createContribution: createContactFormPluginBackendContribution,
    createHostContribution: createContactFormHostContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "contact_form",
  ContactFormPluginBackendContributionDeps,
  ContactFormPluginBackendContribution,
  unknown,
  BackendHostContext
>;

export default contactFormBackendPluginPackage;
