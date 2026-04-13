import { eq } from "drizzle-orm";
import { newsletterBackendPluginPackage } from "@vivd/plugin-newsletter/backend/plugin";
import { newsletterPluginDefinition } from "@vivd/plugin-newsletter/backend/module";
import { db } from "../../../db";
import {
  newsletterActionToken,
  newsletterSubscriber,
  projectMeta,
  projectPluginInstance,
} from "../../../db/schema";
import { getEmailDeliveryService } from "../../integrations/EmailDeliveryService";
import { buildNewsletterConfirmationEmail } from "../../email/templates";
import { pluginEntitlementService } from "../PluginEntitlementService";
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

type NewsletterBackendContribution = ReturnType<
  typeof newsletterBackendPluginPackage.backend.createContribution
>;

let cachedNewsletterPluginBackendContribution:
  | NewsletterBackendContribution
  | null = null;

function createNewsletterBackendContribution(): NewsletterBackendContribution {
  return newsletterBackendPluginPackage.backend.createContribution({
    db,
    tables: {
      newsletterSubscriber,
      newsletterActionToken,
      projectMeta,
      projectPluginInstance,
    },
    pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return ensureProjectPluginInstance({
          ...options,
          defaultConfig: newsletterPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(options) {
        return getProjectPluginInstance(options);
      },
      async updatePluginInstance(options) {
        const updates: {
          configJson?: unknown;
          status?: string;
          updatedAt: Date;
        } = {
          updatedAt: options.updatedAt ?? new Date(),
        };
        if (Object.prototype.hasOwnProperty.call(options, "configJson")) {
          updates.configJson = options.configJson;
        }
        if (typeof options.status === "string") {
          updates.status = options.status;
        }

        const [updated] = await db
          .update(projectPluginInstance)
          .set(updates)
          .where(eq(projectPluginInstance.id, options.instanceId))
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
      buildConfirmationEmail(options) {
        return buildNewsletterConfirmationEmail(options);
      },
    },
  });
}

export function getNewsletterPluginBackendContribution(): NewsletterBackendContribution {
  if (!cachedNewsletterPluginBackendContribution) {
    cachedNewsletterPluginBackendContribution =
      createNewsletterBackendContribution();
  }

  return cachedNewsletterPluginBackendContribution;
}

export const newsletterPluginBackendContribution = {} as NewsletterBackendContribution;

Object.defineProperties(newsletterPluginBackendContribution, {
  service: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().service;
    },
  },
  module: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().module;
    },
  },
  hooks: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().hooks;
    },
  },
  publicRoutes: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().publicRoutes;
    },
  },
});
