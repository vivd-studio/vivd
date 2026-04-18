import { tableBookingPluginConfigSchema } from "./config";
import { getTableBookingSnippets } from "./snippets";
import { createTableBookingServiceContext } from "./serviceContext";
import {
  TableBookingCapacityError,
  getMissingOperatorCapacityStorageErrorMessage,
  TableBookingPluginNotEnabledError,
  TableBookingQuotaExceededError,
  TableBookingReservationNotFoundError,
  TableBookingSourceHostError,
  TableBookingValidationError,
} from "./serviceErrors";
import { createTableBookingOperatorService } from "./serviceOperators";
import { createTableBookingPublicService } from "./servicePublic";
import { createTableBookingReadService } from "./serviceReads";
import {
  normalizeHostAllowlist,
  resolveDefaultSuccessRedirectTarget,
  resolveEffectiveSourceHosts,
} from "./serviceSourceHosts";
import { normalizeTableBookingConfig } from "./serviceShared";
import type {
  TableBookingPluginInstanceRow,
  TableBookingPluginServiceDeps,
} from "./ports";

export {
  TableBookingCapacityError,
  getMissingOperatorCapacityStorageErrorMessage,
  TableBookingPluginNotEnabledError,
  TableBookingQuotaExceededError,
  TableBookingReservationNotFoundError,
  TableBookingSourceHostError,
  TableBookingValidationError,
  resolveDefaultSuccessRedirectTarget,
};

async function buildInfoPayload(
  context: ReturnType<typeof createTableBookingServiceContext>,
  options: {
    organizationId: string;
    projectSlug: string;
    existing: TableBookingPluginInstanceRow | null;
  },
) {
  const [entitlement, inferredSourceHosts, endpoints, projectTitle] =
    await Promise.all([
      context.pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      }),
      context.inferSourceHosts({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
      }),
      context.resolvePublicEndpoints(),
      context.readProjectTitle(options),
    ]);

  const config = options.existing
    ? normalizeTableBookingConfig(options.existing.configJson)
    : null;
  const effectiveSourceHosts = config
    ? resolveEffectiveSourceHosts(config, inferredSourceHosts, context.deps)
    : normalizeHostAllowlist(inferredSourceHosts, context.deps);
  const snippets =
    options.existing && config
      ? getTableBookingSnippets(
          options.existing.publicToken,
          {
            availabilityEndpoint: endpoints.availabilityEndpoint,
            bookEndpoint: endpoints.bookEndpoint,
          },
          config,
        )
      : null;

  const counts = config
    ? await context.getSummaryCounts({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        config,
        rangeDays: 7,
      })
    : {
        bookingsToday: 0,
        coversToday: 0,
        upcomingBookings: 0,
        upcomingCovers: 0,
        cancelled: 0,
        noShow: 0,
        completed: 0,
        booked: 0,
      };

  return {
    entitled: entitlement.state === "enabled",
    entitlementState: entitlement.state,
    enabled: options.existing?.status === "enabled",
    instanceId: options.existing?.id ?? null,
    status: options.existing?.status ?? null,
    publicToken: options.existing?.publicToken ?? null,
    config,
    snippets,
    usage: {
      availabilityEndpoint: endpoints.availabilityEndpoint,
      bookEndpoint: endpoints.bookEndpoint,
      cancelEndpoint: endpoints.cancelEndpoint,
      expectedFields: ["date", "partySize", "time", "name", "email", "phone"],
      optionalFields: ["notes", "_redirect", "_honeypot"],
      inferredAutoSourceHosts: effectiveSourceHosts,
    },
    details: {
      counts: {
        bookingsToday: counts.bookingsToday,
        upcomingBookings: counts.upcomingBookings,
        upcomingCovers: counts.upcomingCovers,
      },
      notificationRecipients: config?.notificationRecipientEmails ?? [],
    },
    instructions: [
      "Use the generated HTML or Astro snippet instead of rebuilding the widget manually.",
      "Configure at least one notification recipient email before launch.",
      `Guest confirmation emails use ${projectTitle} as the visible restaurant/project name.`,
    ],
  };
}

export function createTableBookingPluginService(
  deps: TableBookingPluginServiceDeps,
) {
  const context = createTableBookingServiceContext(deps);
  const reads = createTableBookingReadService(context);
  const operators = createTableBookingOperatorService(context);
  const publicFlows = createTableBookingPublicService(context);

  const service = {
    async ensureTableBookingPlugin(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const ensured = await context.projectPluginInstanceService.ensurePluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      const config = normalizeTableBookingConfig(ensured.row.configJson);
      const endpoints = await context.resolvePublicEndpoints();

      return {
        pluginId: "table_booking" as const,
        instanceId: ensured.row.id,
        status: ensured.row.status,
        created: ensured.created,
        publicToken: ensured.row.publicToken,
        config,
        snippets: getTableBookingSnippets(
          ensured.row.publicToken,
          {
            availabilityEndpoint: endpoints.availabilityEndpoint,
            bookEndpoint: endpoints.bookEndpoint,
          },
          config,
        ),
      };
    },

    async getTableBookingInfo(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const existing = await context.projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      return buildInfoPayload(context, { ...options, existing });
    },

    async updateTableBookingConfig(options: {
      organizationId: string;
      projectSlug: string;
      config: Record<string, unknown>;
    }) {
      const pluginInstance =
        await context.projectPluginInstanceService.getPluginInstance({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: "table_booking",
        });
      if (!pluginInstance) {
        throw new TableBookingPluginNotEnabledError();
      }

      const parsedConfig = tableBookingPluginConfigSchema.parse(options.config);
      await context.projectPluginInstanceService.updatePluginInstance({
        instanceId: pluginInstance.id,
        configJson: parsedConfig,
        updatedAt: new Date(),
      });

      return service.getTableBookingInfo(options);
    },

    ...reads,
    ...operators,
    ...publicFlows,
  };

  return service;
}
