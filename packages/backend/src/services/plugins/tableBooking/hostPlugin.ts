import { eq } from "drizzle-orm";
import { createTableBookingPluginBackendHooks } from "@vivd/plugin-table-booking/backend/integrationHooks";
import { createTableBookingPluginService } from "@vivd/plugin-table-booking/backend/service";
import { tableBookingPluginDefinition } from "@vivd/plugin-table-booking/backend/module";
import { tableBookingBackendPluginPackage } from "@vivd/plugin-table-booking/backend/plugin";
import type { TableBookingPluginEntitlementServicePort } from "@vivd/plugin-table-booking/backend/ports";
import { db } from "../../../db";
import {
  projectMeta,
  projectPluginInstance,
  tableBookingActionToken,
  tableBookingCapacityAdjustment,
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
      tableBookingCapacityAdjustment,
    },
  });

export function createTableBookingBackendHostServiceDeps(options: {
  pluginEntitlementService: TableBookingPluginEntitlementServicePort;
}) {
  return {
    db,
    tables: {
      tableBookingReservation,
      tableBookingActionToken,
      tableBookingCapacityAdjustment,
      projectMeta,
      projectPluginInstance,
    },
    pluginEntitlementService: options.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(hostOptions: {
        organizationId: string;
        projectSlug: string;
        pluginId: "table_booking";
      }) {
        return ensureProjectPluginInstance({
          ...hostOptions,
          defaultConfig: tableBookingPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(hostOptions: {
        organizationId: string;
        projectSlug: string;
        pluginId: "table_booking";
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
      buildGuestConfirmationEmail(hostOptions: {
        projectTitle: string;
        guestName?: string | null;
        partySize: number;
        bookingDateTimeLabel: string;
        cancelUrl: string;
      }) {
        return buildGuestBookingConfirmationEmail(hostOptions);
      },
      buildGuestCancellationEmail(hostOptions: {
        projectTitle: string;
        guestName?: string | null;
        partySize: number;
        bookingDateTimeLabel: string;
      }) {
        return buildGuestBookingCancellationEmail(hostOptions);
      },
      buildStaffNewBookingEmail(hostOptions: {
        projectTitle: string;
        bookingDateTimeLabel: string;
        partySize: number;
        guestName: string;
        guestEmail: string;
        guestPhone: string;
        notes?: string | null;
      }) {
        return buildStaffNewBookingEmail(hostOptions);
      },
      buildStaffCancellationEmail(hostOptions: {
        projectTitle: string;
        bookingDateTimeLabel: string;
        partySize: number;
        guestName: string;
        guestEmail: string;
        guestPhone: string;
        cancelledBy: "guest" | "staff";
        notes?: string | null;
      }) {
        return buildStaffBookingCancellationEmail(hostOptions);
      },
    },
  } as const;
}

export function createTableBookingBackendHostService(options: {
  pluginEntitlementService: TableBookingPluginEntitlementServicePort;
}) {
  return createTableBookingPluginService(
    createTableBookingBackendHostServiceDeps(options),
  );
}

export function createTableBookingBackendHostPluginContribution(options: {
  pluginEntitlementService: TableBookingPluginEntitlementServicePort;
}) {
  const contribution = tableBookingBackendPluginPackage.backend.createContribution(
    createTableBookingBackendHostServiceDeps(options),
  );

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
