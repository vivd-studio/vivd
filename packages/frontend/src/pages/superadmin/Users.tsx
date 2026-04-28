import { UsersTab } from "@/components/admin";
import {
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@vivd/ui";

export default function SuperAdminUsers() {
  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>System Users</PageTitle>
          <PageDescription>
            Manage global user accounts (super-admin only).
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>
      <UsersTab />
    </div>
  );
}
