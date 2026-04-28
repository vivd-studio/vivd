import { useState } from "react";
import { OrganizationsTab } from "@/components/admin";
import {
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@vivd/ui";

export default function SuperAdminOrganizations() {
  const [tab, setTab] = useState("usage");

  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>Organizations</PageTitle>
          <PageDescription>
            Provision organizations, members, and per-org limits.
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>
      <OrganizationsTab selectedOrgId="" activeTab={tab} onTabChange={setTab} />
    </div>
  );
}
