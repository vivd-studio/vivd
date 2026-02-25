import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, Activity, Plug, Wrench, SlidersHorizontal } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/hooks/usePermissions";

const TeamSettings = lazy(() =>
  import("@/components/settings/TeamSettings").then((module) => ({
    default: module.TeamSettings,
  })),
);
const UsageStatsCard = lazy(() =>
  import("@/components/admin/usage/UsageStatsCard").then((module) => ({
    default: module.UsageStatsCard,
  })),
);
const TenantMaintenanceTab = lazy(() =>
  import("@/components/admin/maintenance/TenantMaintenanceTab").then(
    (module) => ({
      default: module.TenantMaintenanceTab,
    }),
  ),
);
const OrgSettings = lazy(() =>
  import("@/components/settings/OrgSettings").then((module) => ({
    default: module.OrgSettings,
  })),
);
const OrganizationPluginsTab = lazy(() =>
  import("@/components/organization/OrganizationPluginsTab").then((module) => ({
    default: module.OrganizationPluginsTab,
  })),
);

function TabLoadingState() {
  return <LoadingSpinner message="Loading..." />;
}

export default function Organization() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organizationRole, isSuperAdmin } = usePermissions();
  const canEditSettings = organizationRole === "owner" || isSuperAdmin;
  const tab = searchParams.get("tab");
  const currentTab =
    tab === "usage" ||
    tab === "maintenance" ||
    tab === "plugins" ||
    (tab === "settings" && canEditSettings)
      ? tab
      : "members";

  const { data: orgData, isLoading } =
    trpc.organization.getMyOrganization.useQuery();
  const org = orgData?.organization ?? null;

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading organization..." />;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight truncate">
            {org?.name ?? "Organization"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage members, usage, and maintenance for your organization.
          </p>
        </div>
        {org && (
          <Badge variant={org.status === "active" ? "default" : "secondary"}>
            {org.status}
          </Badge>
        )}
      </div>

      <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="members" className="gap-2">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-2">
            <Activity className="h-4 w-4" />
            Usage
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="plugins" className="gap-2">
            <Plug className="h-4 w-4" />
            Plugins
          </TabsTrigger>
          {canEditSettings && (
            <TabsTrigger value="settings" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              General
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="members" className="mt-6">
          <Suspense fallback={<TabLoadingState />}>
            <TeamSettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="usage" className="mt-6">
          <Suspense fallback={<TabLoadingState />}>
            <UsageStatsCard />
          </Suspense>
        </TabsContent>

        <TabsContent value="maintenance" className="mt-6">
          <Suspense fallback={<TabLoadingState />}>
            <TenantMaintenanceTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="plugins" className="mt-6">
          <Suspense fallback={<TabLoadingState />}>
            <OrganizationPluginsTab />
          </Suspense>
        </TabsContent>

        {canEditSettings && (
          <TabsContent value="settings" className="mt-6">
            <Suspense fallback={<TabLoadingState />}>
              <OrgSettings />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
