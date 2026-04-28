import { UsageStatsCard } from "@/components/admin";
import {
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@vivd/ui";

export default function SuperAdminUsage() {
  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>Usage</PageTitle>
          <PageDescription>
            Usage is shown for your currently active organization.
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>
      <UsageStatsCard />
    </div>
  );
}
