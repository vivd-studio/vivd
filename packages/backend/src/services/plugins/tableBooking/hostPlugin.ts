import { eq } from "drizzle-orm";
import { createTableBookingPluginBackendHooks } from "@vivd/plugin-table-booking/backend/integrationHooks";
import { tableBookingPluginDefinition } from "@vivd/plugin-table-booking/backend/module";
import { tableBookingBackendPluginPackage } from "@vivd/plugin-table-booking/backend/plugin";
import type { TableBookingPluginEntitlementServicePort } from "@vivd/plugin-table-booking/backend/ports";
import { db } from "../../../db";
import {
  projectMeta,
  projectPluginInstance,
  tableBookingActionToken,
  tableBookingReservation,
} from "../../../db/schema";
import {
  buildGuestBookingCancellationEmail,
  buildGuestBookingConfirmationEmail,
  buildStaffBookingCancellationEmail,
  buildStaffNewBookingEmail,
} from "../../email/templates";
import { getEmailDeliveryService } from "../../integrations/EmailDeliveryService";
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
} from "../core/instanceStore";
import { getPublicPluginApiBaseUrl } from "../runtime/publicApi";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  normalizeHostCandidate,
} from "../runtime/hostUtils";
import { inferProjectPluginSourceHosts } from "../runtime/sourceHosts";

export const tableBookingBackendPluginHooks =
  createTableBookingPluginBackendHooks({
    db,
    tables: {
      tableBookingReservation,
      tableBookingActionToken,
    },
  });

export function createTableBookingBackendHostPluginContribution(options: {
  pluginEntitlementService: TableBookingPluginEntitlementServicePort;
}) {
  const contribution = tableBookingBackendPluginPackage.backend.createContribution({
    db,
    tables: {
      tableBookingReservation,
      tableBookingActionToken,
      projectMeta,
      projectPluginInstance,
    },
    pluginEntitlementService: options.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(hostOptions) {
        return ensureProjectPluginInstance({
          ...hostOptions,
          defaultConfig: tableBookingPluginDefinition.defaultConfig,
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
      buildGuestConfirmationEmail(hostOptions) {
        return buildGuestBookingConfirmationEmail(hostOptions);
      },
      buildGuestCancellationEmail(hostOptions) {
        return buildGuestBookingCancellationEmail(hostOptions);
      },
      buildStaffNewBookingEmail(hostOptions) {
        return buildStaffNewBookingEmail(hostOptions);
      },
      buildStaffCancellationEmail(hostOptions) {
        return buildStaffBookingCancellationEmail(hostOptions);
      },
    },
  });

  return {
    ...contribution,
    hooks: tableBookingBackendPluginHooks,
  };
}

export const tableBookingBackendHostPlugin = {
  pluginId: tableBookingBackendPluginPackage.pluginId,
  hooks: tableBookingBackendPluginHooks,
  createContribution: createTableBookingBackendHostPluginContribution,
} as const;
