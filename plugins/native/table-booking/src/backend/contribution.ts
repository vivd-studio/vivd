import type { PluginContribution } from "@vivd/plugin-sdk";
import type {
  TableBookingBackendRouteDefinition,
  TableBookingPluginServiceDeps,
} from "./ports";
import { createTableBookingPluginBackendHooks } from "./integrationHooks";
import { createTableBookingPluginModule } from "./module";
import {
  TableBookingCapacityError,
  TableBookingPluginNotEnabledError,
  TableBookingQuotaExceededError,
  TableBookingReservationNotFoundError,
  TableBookingSourceHostError,
  TableBookingValidationError,
  createTableBookingPluginService,
} from "./service";
import { createTableBookingAvailabilityRouter } from "./http/availability";
import { createTableBookingBookRouter } from "./http/book";
import { createTableBookingCancelRouter } from "./http/cancel";

export interface TableBookingPluginBackendContribution
  extends PluginContribution<
    "table_booking",
    ReturnType<typeof createTableBookingPluginBackendHooks>,
    TableBookingBackendRouteDefinition
  > {
  service: ReturnType<typeof createTableBookingPluginService>;
}

export interface TableBookingPluginBackendContributionDeps
  extends TableBookingPluginServiceDeps {}

export function createTableBookingPluginBackendContribution(
  deps: TableBookingPluginBackendContributionDeps,
): TableBookingPluginBackendContribution {
  const service = createTableBookingPluginService(deps);

  return {
    service,
    module: createTableBookingPluginModule({
      async ensurePlugin(options) {
        const result = await service.ensureTableBookingPlugin(options);
        return {
          instanceId: result.instanceId,
          created: result.created,
          status: result.status,
        };
      },
      getInfo(options) {
        return service.getTableBookingInfo(options);
      },
      updateConfig(options) {
        return service.updateTableBookingConfig(options);
      },
      cancelBookingById(options) {
        return service.cancelBookingById(options);
      },
      markBookingNoShow(options) {
        return service.markBookingNoShow(options);
      },
      markBookingCompleted(options) {
        return service.markBookingCompleted(options);
      },
      readSummary(options) {
        return service.getTableBookingSummary(options);
      },
      readBookings(options) {
        return service.listBookings(options);
      },
      readAgenda(options) {
        return service.getAgenda(options);
      },
      mapPublicError(context) {
        const { error } = context;
        if (
          error instanceof TableBookingPluginNotEnabledError ||
          error instanceof TableBookingSourceHostError ||
          error instanceof TableBookingValidationError ||
          error instanceof TableBookingCapacityError ||
          error instanceof TableBookingQuotaExceededError ||
          error instanceof TableBookingReservationNotFoundError
        ) {
          return {
            code: "BAD_REQUEST" as const,
            message: error.message,
          };
        }
        return null;
      },
    }),
    hooks: createTableBookingPluginBackendHooks({
      db: deps.db,
      tables: {
        tableBookingReservation: deps.tables.tableBookingReservation,
        tableBookingActionToken: deps.tables.tableBookingActionToken,
      },
    }),
    publicRoutes: [
      {
        routeId: "table_booking.availability",
        mountPath: "/plugins",
        createRouter: (routeDeps) =>
          createTableBookingAvailabilityRouter({
            upload: routeDeps.upload,
            service,
          }),
      },
      {
        routeId: "table_booking.book",
        mountPath: "/plugins",
        createRouter: (routeDeps) =>
          createTableBookingBookRouter({
            upload: routeDeps.upload,
            service,
          }),
      },
      {
        routeId: "table_booking.cancel",
        mountPath: "/plugins",
        createRouter: () =>
          createTableBookingCancelRouter({
            service,
          }),
      },
    ],
  };
}
