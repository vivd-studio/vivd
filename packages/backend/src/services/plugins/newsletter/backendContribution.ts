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

export const newsletterPluginBackendContribution =
  newsletterBackendPluginPackage.backend.createContribution({
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
  });

export const newsletterPluginService = newsletterPluginBackendContribution.service;
export const newsletterPluginModule = newsletterPluginBackendContribution.module;
export const newsletterPluginPublicRoutes =
  newsletterPluginBackendContribution.publicRoutes;
