import { UsersTab } from "@/components/admin";

export default function SuperAdminUsers() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Users</h1>
        <p className="text-muted-foreground mt-1">
          Manage global user accounts (super-admin only).
        </p>
      </div>
      <UsersTab />
    </div>
  );
}

