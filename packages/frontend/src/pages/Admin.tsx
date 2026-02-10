import { useSearchParams } from "react-router-dom";
import { Shield, Wrench, Activity } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { OrganizationsTab, UsersTab, MaintenanceTab, UsageStatsCard } from "@/components/admin";

export default function Admin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "users";
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "super_admin";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Manage system users and settings.
          </p>
        </div>
      </div>

      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <TabsList className="w-full justify-start">
          {isAdmin && (
            <TabsTrigger value="orgs" className="gap-2">
              <Shield className="h-4 w-4" />
              Organizations
            </TabsTrigger>
          )}
          <TabsTrigger value="users" className="gap-2">
            <Shield className="h-4 w-4" />
            Users
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="usage" className="gap-2">
                <Activity className="h-4 w-4" />
                Usage
              </TabsTrigger>
              <TabsTrigger value="maintenance" className="gap-2">
                <Wrench className="h-4 w-4" />
                Maintenance
              </TabsTrigger>
            </>
          )}
        </TabsList>

      <TabsContent value="users" className="mt-6">
        <UsersTab />
      </TabsContent>

      {isAdmin && (
        <TabsContent value="orgs" className="mt-6">
          <OrganizationsTab />
        </TabsContent>
      )}

      {isAdmin && (
        <TabsContent value="usage" className="mt-6">
          <UsageStatsCard />
        </TabsContent>
      )}

        {isAdmin && (
          <TabsContent value="maintenance" className="mt-6">
            <MaintenanceTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
