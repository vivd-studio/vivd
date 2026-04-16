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
  newsletterSubscriber,
  projectMeta,
  projectPluginInstance,
} from "../../../db/schema";
import { buildNewsletterConfirmationEmail } from "../../email/templates";
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

export const newsletterBackendPluginHooks =
  (createNewsletterPluginBackendHooks as (deps: any) => any)({
    db,
    tables: {
      newsletterSubscriber,
      newsletterActionToken,
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
      projectMeta,
      projectPluginInstance,
    },
    pluginEntitlementService: options.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(hostOptions) {
        return ensureProjectPluginInstance({
          ...hostOptions,
          defaultConfig: newsletterPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(hostOptions) {
        return getProjectPluginInstance(hostOptions);
      },
      async updatePluginInstance(hostOptions) {
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
      buildConfirmationEmail(hostOptions) {
        return buildNewsletterConfirmationEmail(hostOptions);
      },
    },
  });

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
