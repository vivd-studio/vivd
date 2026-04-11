import type {
  PluginEntitlementManagedBy,
  PluginEntitlementScope,
  PluginEntitlementState,
} from "./PluginEntitlementService";
import type { PluginCatalogEntry, PluginId } from "./catalog";

export type PluginInstallState = "disabled" | "available" | "enabled" | "suspended";
export type PluginIssueSeverity = "warning" | "info";
export type PluginBadgeTone = "success" | "secondary" | "outline" | "destructive";

export interface PluginSurfaceBadge {
  label: string;
  tone: PluginBadgeTone;
}

export interface ProjectPluginCatalogItem {
  pluginId: PluginId;
  catalog: PluginCatalogEntry;
  installState: PluginInstallState;
  entitled: boolean;
  entitlementState: PluginEntitlementState;
  instanceId: string | null;
  instanceStatus: string | null;
  updatedAt: string | null;
}

export interface OrganizationPluginIssue {
  code: string;
  severity: PluginIssueSeverity;
  message: string;
}

export interface OrganizationProjectPluginItem extends ProjectPluginCatalogItem {
  summaryLines: string[];
  badges: PluginSurfaceBadge[];
}

export interface OrganizationProjectPluginsOverviewRow {
  projectSlug: string;
  projectTitle: string;
  updatedAt: string;
  deployedDomain: string | null;
  plugins: OrganizationProjectPluginItem[];
  issues: OrganizationPluginIssue[];
}

export interface SuperAdminProjectPluginAccessItem {
  pluginId: PluginId;
  catalog: PluginCatalogEntry;
  effectiveScope: PluginEntitlementScope;
  state: PluginEntitlementState;
  managedBy: PluginEntitlementManagedBy;
  monthlyEventLimit: number | null;
  hardStop: boolean;
  turnstileEnabled: boolean;
  turnstileReady: boolean;
  usageThisMonth: number;
  projectPluginStatus: "enabled" | "disabled" | null;
  updatedAt: string | null;
}

export interface SuperAdminProjectPluginAccessRow {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  projectSlug: string;
  projectTitle: string;
  isDeployed: boolean;
  deployedDomain: string | null;
  plugins: SuperAdminProjectPluginAccessItem[];
  updatedAt: string | null;
}

export function derivePluginInstallState(input: {
  entitlementState: PluginEntitlementState;
  instanceStatus: string | null | undefined;
}): PluginInstallState {
  if (input.entitlementState === "suspended") return "suspended";
  if (
    input.entitlementState === "enabled" &&
    input.instanceStatus === "enabled"
  ) {
    return "enabled";
  }
  if (input.entitlementState === "enabled" && !input.instanceStatus) {
    return "available";
  }
  return "disabled";
}
