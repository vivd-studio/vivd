import { UsageStatsCard } from "@/components/admin";

export default function SuperAdminUsage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Usage</h1>
        <p className="text-muted-foreground mt-1">
          Usage is shown for your currently active organization.
        </p>
      </div>
      <UsageStatsCard />
    </div>
  );
}

