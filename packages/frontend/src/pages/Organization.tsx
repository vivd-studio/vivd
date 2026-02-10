import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { UsageStatsCard } from "@/components/admin";

function formatMaxProjects(value: unknown): string {
  if (typeof value !== "number") return "Unlimited";
  if (!Number.isFinite(value) || value <= 0) return "Unlimited";
  return String(Math.floor(value));
}

export default function Organization() {
  const { data: orgData, isLoading, error } =
    trpc.organization.getMyOrganization.useQuery();
  const { data: projectsData } = trpc.project.list.useQuery();

  const org = orgData?.organization ?? null;
  const projectCount = projectsData?.projects?.length ?? 0;
  const maxProjectsRaw =
    org?.limits && typeof org.limits === "object"
      ? (org.limits as Record<string, unknown>).maxProjects
      : undefined;
  const maxProjects = formatMaxProjects(maxProjectsRaw);

  if (isLoading) {
    return <div className="text-muted-foreground">Loading organization…</div>;
  }

  if (error || !org) {
    return (
      <div className="text-red-500">
        Failed to load organization: {String(error ?? "Unknown error")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight truncate">
            {org.name}
          </h1>
          <p className="text-muted-foreground mt-1">Organization settings.</p>
        </div>
        <Badge variant={org.status === "active" ? "default" : "secondary"}>
          {org.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">GitHub repo prefix</span>
            <span className="font-mono text-xs">{org.githubRepoPrefix || "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Max projects</span>
            <span className="font-medium">{maxProjects}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Current projects</span>
            <span className="font-medium">{projectCount}</span>
          </div>
        </CardContent>
      </Card>

      <UsageStatsCard />
    </div>
  );
}
