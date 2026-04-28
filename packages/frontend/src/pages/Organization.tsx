import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, Activity, Plug, Wrench, SlidersHorizontal } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import {
  Badge,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@vivd/ui";

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

type OrganizationSection =
  | "members"
  | "usage"
  | "maintenance"
  | "plugins"
  | "settings";

const ORGANIZATION_SECTION_META: Record<
  OrganizationSection,
  { title: string; description: (organizationName: string) => string }
> = {
  members: {
    title: "Members",
    description: (organizationName) =>
      `Manage members and project access for ${organizationName}.`,
  },
  usage: {
    title: "Usage",
    description: (organizationName) =>
      `Review usage and limits for ${organizationName}.`,
  },
  maintenance: {
    title: "Maintenance",
    description: (organizationName) =>
      `Run maintenance actions for ${organizationName}.`,
  },
  plugins: {
    title: "Plugins",
    description: (organizationName) =>
      `Manage plugin access for ${organizationName}.`,
  },
  settings: {
    title: "General",
    description: (organizationName) =>
      `Update organization settings for ${organizationName}.`,
  },
};

function TabLoadingState() {
  return <LoadingSpinner message="Loading..." />;
}

export default function Organization() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organizationRole, isSuperAdmin } = usePermissions();
  const canEditSettings = organizationRole === "owner" || isSuperAdmin;
  const tab = searchParams.get("tab");
  const currentTab: OrganizationSection =
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

  const organizationName = org?.name ?? "your organization";
  const sectionMeta = ORGANIZATION_SECTION_META[currentTab];

  return (
    <div className="space-y-8">
      <PageHeader className="items-center">
        <PageHeaderContent>
          <PageTitle className="truncate">{sectionMeta.title}</PageTitle>
          <PageDescription>
            {sectionMeta.description(organizationName)}
          </PageDescription>
        </PageHeaderContent>
        {org && (
          <Badge variant={org.status === "active" ? "default" : "secondary"}>
            {org.status}
          </Badge>
        )}
      </PageHeader>

      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
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
