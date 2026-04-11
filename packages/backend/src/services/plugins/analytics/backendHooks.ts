import { createAnalyticsPluginBackendHooks } from "@vivd/plugin-analytics/backend/integrationHooks";
import { db } from "../../../db";
import { analyticsEvent } from "../../../db/schema";

export const analyticsPluginBackendHooks =
  createAnalyticsPluginBackendHooks({
    db,
    tables: {
      analyticsEvent,
    },
  });
