import { useState } from "react";
import { OrganizationsTab } from "@/components/admin";

export default function SuperAdminOrganizations() {
  const [tab, setTab] = useState("usage");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
        <p className="text-muted-foreground mt-1">
          Provision organizations, members, and per-org limits.
        </p>
      </div>
      <OrganizationsTab
        selectedOrgId=""
        activeTab={tab}
        onTabChange={setTab}
      />
    </div>
  );
}
