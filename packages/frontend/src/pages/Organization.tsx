import { useSearchParams } from "react-router-dom";
import { Users, Activity, Wrench, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsageStatsCard, TenantMaintenanceTab } from "@/components/admin";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { OrgSettings } from "@/components/settings/OrgSettings";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/hooks/usePermissions";

export default function Organization() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organizationRole, isSuperAdmin } = usePermissions();
  const canEditSettings = organizationRole === "owner" || isSuperAdmin;
  const tab = searchParams.get("tab");
  const currentTab =
    tab === "usage" || tab === "maintenance" || (tab === "settings" && canEditSettings)
      ? tab
      : "members";

  const { data: orgData, isLoading } =
    trpc.organization.getMyOrganization.useQuery();
  const org = orgData?.organization ?? null;

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading organization…</div>;
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
          {canEditSettings && (
            <TabsTrigger value="settings" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              General
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="members" className="mt-6">
          <TeamSettings />
        </TabsContent>

        <TabsContent value="usage" className="mt-6">
          <UsageStatsCard />
        </TabsContent>

        <TabsContent value="maintenance" className="mt-6">
          <TenantMaintenanceTab />
        </TabsContent>

        {canEditSettings && (
          <TabsContent value="settings" className="mt-6">
            <OrgSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
