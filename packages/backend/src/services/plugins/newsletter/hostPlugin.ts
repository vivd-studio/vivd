import { eq } from "drizzle-orm";
import { createNewsletterPluginBackendHooks } from "@vivd/plugin-newsletter/backend/integrationHooks";
import { newsletterPluginDefinition } from "@vivd/plugin-newsletter/backend/module";
import {
  newsletterBackendPluginPackage,
} from "@vivd/plugin-newsletter/backend/plugin";
import type { NewsletterPluginEntitlementServicePort } from "@vivd/plugin-newsletter/backend/ports";
import { db } from "../../../db";
import {
  newsletterActionToken,
  newsletterCampaign,
  newsletterCampaignDelivery,
  newsletterSubscriber,
  projectMeta,
  projectPluginInstance,
} from "../../../db/schema";
import {
  buildNewsletterCampaignEmail,
  buildNewsletterConfirmationEmail,
} from "../../email/templates";
import { getEmailDeliveryService } from "../../integrations/EmailDeliveryService";
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
} from "../core/instanceStore";
import { getPublicPluginApiBaseUrl } from "../runtime/publicApi";
import { inferProjectPluginSourceHosts } from "../runtime/sourceHosts";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  normalizeHostCandidate,
} from "../runtime/hostUtils";

let runQueuedNewsletterCampaigns: (() => Promise<number>) | null = null;

export const newsletterBackendPluginHooks =
  (createNewsletterPluginBackendHooks as (deps: any) => any)({
    db,
    tables: {
      newsletterSubscriber,
      newsletterActionToken,
      newsletterCampaign,
      newsletterCampaignDelivery,
    },
    processQueuedCampaigns() {
      return runQueuedNewsletterCampaigns?.() ?? Promise.resolve(0);
    },
  });

export function createNewsletterBackendHostPluginContribution(options: {
  pluginEntitlementService: NewsletterPluginEntitlementServicePort;
}) {
  const contribution = (
    newsletterBackendPluginPackage.backend.createContribution as (deps: any) => any
  )({
    db,
    tables: {
      newsletterSubscriber,
      newsletterActionToken,
      newsletterCampaign,
      newsletterCampaignDelivery,
      projectMeta,
      projectPluginInstance,
    },
    pluginEntitlementService: options.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(hostOptions: {
        organizationId: string;
        projectSlug: string;
        pluginId: "newsletter";
      }) {
        return ensureProjectPluginInstance({
          ...hostOptions,
          defaultConfig: newsletterPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(hostOptions: {
        organizationId: string;
        projectSlug: string;
        pluginId: "newsletter";
      }) {
        return getProjectPluginInstance(hostOptions);
      },
      async updatePluginInstance(hostOptions: {
        instanceId: string;
        configJson?: unknown;
        status?: string;
        updatedAt?: Date;
      }) {
        const updates: {
          configJson?: unknown;
          status?: string;
          updatedAt: Date;
        } = {
          updatedAt: hostOptions.updatedAt ?? new Date(),
        };
        if (Object.prototype.hasOwnProperty.call(hostOptions, "configJson")) {
          updates.configJson = hostOptions.configJson;
        }
        if (typeof hostOptions.status === "string") {
          updates.status = hostOptions.status;
        }

        const [updated] = await db
          .update(projectPluginInstance)
          .set(updates)
          .where(eq(projectPluginInstance.id, hostOptions.instanceId))
          .returning();

        return updated ?? null;
      },
    },
    getPublicPluginApiBaseUrl,
    inferSourceHosts: inferProjectPluginSourceHosts,
    hostUtils: {
      extractSourceHostFromHeaders,
      isHostAllowed,
      normalizeHostCandidate,
    },
    emailDeliveryService: getEmailDeliveryService(),
    emailTemplates: {
      buildConfirmationEmail(hostOptions: {
        projectTitle: string;
        recipientName?: string | null;
        confirmUrl: string;
        unsubscribeUrl: string;
        expiresInSeconds: number;
        mode: "newsletter" | "waitlist";
      }) {
        return buildNewsletterConfirmationEmail(hostOptions);
      },
      buildCampaignEmail(hostOptions: {
        projectTitle: string;
        recipientName?: string | null;
        subject: string;
        body: string;
        unsubscribeUrl?: string | null;
        mode: "newsletter" | "waitlist";
        isTest?: boolean;
      }) {
        return buildNewsletterCampaignEmail(hostOptions);
      },
    },
  });

  runQueuedNewsletterCampaigns = () => contribution.service.processQueuedCampaigns();

  return {
    ...contribution,
    hooks: newsletterBackendPluginHooks,
  };
}

export const newsletterBackendHostPlugin = {
  pluginId: newsletterBackendPluginPackage.pluginId,
  hooks: newsletterBackendPluginHooks,
  createContribution: createNewsletterBackendHostPluginContribution,
} as const;
