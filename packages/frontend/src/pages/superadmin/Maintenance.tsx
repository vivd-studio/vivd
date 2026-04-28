import { MaintenanceTab } from "@/components/admin";
import {
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@vivd/ui";

export default function SuperAdminMaintenance() {
  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>Maintenance</PageTitle>
          <PageDescription>
            System maintenance operations (super-admin only).
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>
      <MaintenanceTab />
    </div>
  );
}
