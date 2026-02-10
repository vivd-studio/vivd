import { MaintenanceTab } from "@/components/admin";

export default function SuperAdminMaintenance() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Maintenance</h1>
        <p className="text-muted-foreground mt-1">
          System maintenance operations (super-admin only).
        </p>
      </div>
      <MaintenanceTab />
    </div>
  );
}

