import * as tables from "../../db/schema";
import { db } from "../../db";
import { emailDeliverabilityService, isSesFeedbackAutoConfirmEnabled } from "../email/deliverability";
import { emailTemplateBrandingService } from "../email/templateBranding";
import { getEmailDeliveryService } from "../integrations/EmailDeliveryService";
import { installProfileService } from "../system/InstallProfileService";
import { pluginEntitlementService } from "./PluginEntitlementService";
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
  updateProjectPluginInstance,
} from "./core/instanceStore";
import {
  getControlPlaneOrigin,
  getPublicPluginApiBaseUrl,
} from "./runtime/publicApi";
import { inferProjectPluginSourceHosts } from "./runtime/sourceHosts";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  normalizeHostCandidate,
} from "./runtime/hostUtils";

export const backendPluginHostContext = {
  db,
  tables,
  pluginEntitlementService,
  projectPluginInstanceService: {
    ensurePluginInstance: ensureProjectPluginInstance,
    getPluginInstance: getProjectPluginInstance,
    updatePluginInstance: updateProjectPluginInstance,
  },
  runtime: {
    getPublicPluginApiBaseUrl,
    getControlPlaneOrigin,
    inferProjectPluginSourceHosts,
    hostUtils: {
      extractSourceHostFromHeaders,
      isHostAllowed,
      normalizeHostCandidate,
    },
    env: {
      nodeEnv: process.env.NODE_ENV,
      flyStudioPublicHost: process.env.FLY_STUDIO_PUBLIC_HOST,
      flyStudioApp: process.env.FLY_STUDIO_APP,
    },
  },
  email: {
    deliveryService: getEmailDeliveryService(),
    deliverabilityService: emailDeliverabilityService,
    brandingResolver: emailTemplateBrandingService,
    isSesFeedbackAutoConfirmEnabled,
  },
  system: {
    installProfileService,
  },
} as const;
