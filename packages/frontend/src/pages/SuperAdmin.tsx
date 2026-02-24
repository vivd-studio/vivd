import { useSearchParams } from "react-router-dom";
import { Building2, Mail, Plug, Server, Shield, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmailTab,
  MachinesTab,
  MaintenanceTab,
  OrganizationsTab,
  PluginsTab,
  UsersTab,
} from "@/components/admin";

export default function SuperAdmin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const currentTab =
    tab === "users" ||
    tab === "maintenance" ||
    tab === "machines" ||
    tab === "plugins" ||
    tab === "email"
      ? tab
      : "orgs";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Super Admin</h1>
        <p className="text-muted-foreground mt-1">
          Manage organizations, global users, and platform maintenance.
        </p>
      </div>

      <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="orgs" className="gap-2">
            <Building2 className="h-4 w-4" />
            Organizations
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Shield className="h-4 w-4" />
            System Users
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="machines" className="gap-2">
            <Server className="h-4 w-4" />
            Machines
          </TabsTrigger>
          <TabsTrigger value="plugins" className="gap-2">
            <Plug className="h-4 w-4" />
            Plugins
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-4 w-4" />
            Email
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orgs" className="mt-6">
          <OrganizationsTab />
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <UsersTab />
        </TabsContent>

        <TabsContent value="maintenance" className="mt-6">
          <MaintenanceTab />
        </TabsContent>

        <TabsContent value="machines" className="mt-6">
          <MachinesTab />
        </TabsContent>

        <TabsContent value="plugins" className="mt-6">
          <PluginsTab />
        </TabsContent>

        <TabsContent value="email" className="mt-6">
          <EmailTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
