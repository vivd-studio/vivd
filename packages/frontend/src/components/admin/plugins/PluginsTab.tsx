import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import { Loader2, Plug, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterInputs } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AccessStateFilter = "all" | "enabled" | "disabled" | "suspended";
type SuperAdminPluginId =
  RouterInputs["superadmin"]["pluginsUpsertEntitlement"]["pluginId"];

type PluginTabConfig = {
  id: SuperAdminPluginId;
  label: string;
  description: string;
  Panel: ComponentType;
};

function formatDate(value: Date | string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatStateBadgeVariant(
  state: "enabled" | "disabled" | "suspended",
): "default" | "secondary" | "outline" {
  if (state === "enabled") return "default";
  if (state === "suspended") return "secondary";
  return "outline";
}

export function PluginsTab() {
  const [activePluginId, setActivePluginId] = useState<SuperAdminPluginId>(
    SUPERADMIN_PLUGIN_TABS[0].id,
  );

  const handlePluginTabChange = (value: string) => {
    const plugin = SUPERADMIN_PLUGIN_TABS.find((item) => item.id === value);
    if (!plugin) return;
    setActivePluginId(plugin.id);
  };

  return (
    <Tabs
      value={activePluginId}
      onValueChange={handlePluginTabChange}
      className="w-full"
    >
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Plugin Access
          </CardTitle>
          <CardDescription>
            Central super-admin controls for project-level plugin entitlements.
          </CardDescription>
          <TabsList className="w-full justify-start">
            {SUPERADMIN_PLUGIN_TABS.map((plugin) => (
              <TabsTrigger key={plugin.id} value={plugin.id}>
                {plugin.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </CardHeader>
        <CardContent>
          {SUPERADMIN_PLUGIN_TABS.map((plugin) => (
            <TabsContent key={plugin.id} value={plugin.id} className="mt-0 space-y-4">
              <p className="text-sm text-muted-foreground">{plugin.description}</p>
              <plugin.Panel />
            </TabsContent>
          ))}
        </CardContent>
      </Card>
    </Tabs>
  );
}

function ContactFormPluginAccessPanel() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<AccessStateFilter>("all");
  const pluginId: SuperAdminPluginId = "contact_form";

  const listQuery = trpc.superadmin.pluginsListAccess.useQuery({
    pluginId,
    search: search.trim() ? search.trim() : undefined,
    state: stateFilter === "all" ? undefined : stateFilter,
    limit: 500,
    offset: 0,
  });

  const upsertMutation = trpc.superadmin.pluginsUpsertEntitlement.useMutation({
    onSuccess: async () => {
      toast.success("Plugin access updated");
      await utils.superadmin.pluginsListAccess.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update plugin access", {
        description: error.message,
      });
    },
  });

  const rows = useMemo(() => listQuery.data?.rows ?? [], [listQuery.data?.rows]);

  const updateState = (
    row: (typeof rows)[number],
    state: "enabled" | "disabled" | "suspended",
  ) => {
    upsertMutation.mutate({
      pluginId,
      organizationId: row.organizationId,
      scope: "project",
      projectSlug: row.projectSlug,
      state,
      monthlyEventLimit: row.monthlyEventLimit,
      hardStop: row.hardStop,
      turnstileEnabled: row.turnstileEnabled,
      notes: `Updated from Super Admin Plugins tab (${state})`,
      ensurePluginWhenEnabled: true,
    });
  };

  const updateLimit = (row: (typeof rows)[number]) => {
    const current = row.monthlyEventLimit == null ? "" : String(row.monthlyEventLimit);
    const raw = window.prompt(
      "Set monthly contact form submission limit.\nLeave empty for unlimited.",
      current,
    );
    if (raw === null) return;

    const trimmed = raw.trim();
    if (!trimmed) {
      upsertMutation.mutate({
        pluginId,
        organizationId: row.organizationId,
        scope: "project",
        projectSlug: row.projectSlug,
        state: row.state,
        monthlyEventLimit: null,
        hardStop: row.hardStop,
        turnstileEnabled: row.turnstileEnabled,
        notes: "Set to unlimited from Super Admin Plugins tab",
        ensurePluginWhenEnabled: false,
      });
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Limit must be a non-negative number");
      return;
    }

    upsertMutation.mutate({
      pluginId,
      organizationId: row.organizationId,
      scope: "project",
      projectSlug: row.projectSlug,
      state: row.state,
      monthlyEventLimit: Math.floor(parsed),
      hardStop: row.hardStop,
      turnstileEnabled: row.turnstileEnabled,
      notes: "Updated monthly limit from Super Admin Plugins tab",
      ensurePluginWhenEnabled: false,
    });
  };

  const updateTurnstile = (row: (typeof rows)[number], enabled: boolean) => {
    upsertMutation.mutate({
      pluginId,
      organizationId: row.organizationId,
      scope: "project",
      projectSlug: row.projectSlug,
      state: row.state,
      monthlyEventLimit: row.monthlyEventLimit,
      hardStop: row.hardStop,
      turnstileEnabled: enabled,
      notes: enabled
        ? "Enabled Turnstile from Super Admin Plugins tab"
        : "Disabled Turnstile from Super Admin Plugins tab",
      ensurePluginWhenEnabled: false,
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Selected plugin controls the project access list below. This tab manages
        Contact Form enablement, limits, and Turnstile behavior.
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search org or project..."
          className="md:max-w-sm"
        />
        <Select
          value={stateFilter}
          onValueChange={(value) => setStateFilter(value as AccessStateFilter)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by state" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="enabled">Enabled</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => void listQuery.refetch()}
          disabled={listQuery.isFetching}
        >
          <RefreshCcw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>
      {listQuery.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Failed to load plugin access: {listQuery.error.message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Organization</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Submissions (month)</th>
              <th className="px-3 py-2 font-medium">Submission limit</th>
              <th className="px-3 py-2 font-medium">Turnstile</th>
              <th className="px-3 py-2 font-medium">Plugin instance</th>
              <th className="px-3 py-2 font-medium">Updated</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.organizationId}:${row.projectSlug}`}
                className="border-t align-top"
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{row.organizationName}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.organizationSlug}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{row.projectSlug}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.projectTitle || "(untitled)"}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={formatStateBadgeVariant(row.state)}>
                    {row.state}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {row.effectiveScope}
                  </span>
                </td>
                <td className="px-3 py-2">{row.usageThisMonth}</td>
                <td className="px-3 py-2">
                  {row.monthlyEventLimit == null ? "Unlimited" : row.monthlyEventLimit}
                </td>
                <td className="px-3 py-2">
                  {row.turnstileEnabled ? (
                    row.state !== "enabled" ? (
                      <Badge variant="secondary">On (inactive)</Badge>
                    ) : (
                      <Badge variant={row.turnstileReady ? "default" : "secondary"}>
                        {row.turnstileReady ? "Enabled" : "Syncing"}
                      </Badge>
                    )
                  ) : (
                    <Badge variant="outline">Off</Badge>
                  )}
                </td>
                <td className="px-3 py-2">{row.projectPluginStatus || "-"}</td>
                <td className="px-3 py-2">{formatDate(row.updatedAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={row.state === "enabled" ? "default" : "outline"}
                      disabled={upsertMutation.isPending}
                      onClick={() => updateState(row, "enabled")}
                    >
                      Enable
                    </Button>
                    <Button
                      size="sm"
                      variant={row.state === "disabled" ? "secondary" : "outline"}
                      disabled={upsertMutation.isPending}
                      onClick={() => updateState(row, "disabled")}
                    >
                      Disable
                    </Button>
                    <Button
                      size="sm"
                      variant={row.state === "suspended" ? "secondary" : "outline"}
                      disabled={upsertMutation.isPending}
                      onClick={() => updateState(row, "suspended")}
                    >
                      Suspend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={upsertMutation.isPending}
                      onClick={() => updateLimit(row)}
                    >
                      Limit
                    </Button>
                    <Button
                      size="sm"
                      variant={row.turnstileEnabled ? "secondary" : "outline"}
                      disabled={upsertMutation.isPending}
                      onClick={() => updateTurnstile(row, !row.turnstileEnabled)}
                    >
                      {row.turnstileEnabled ? "Turnstile Off" : "Turnstile On"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                  {listQuery.isLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading plugin access...
                    </span>
                  ) : (
                    "No projects match the current filters."
                  )}
                </td>
                </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SUPERADMIN_PLUGIN_TABS: ReadonlyArray<PluginTabConfig> = [
  {
    id: "contact_form",
    label: "Contact Form",
    description:
      "Choose a plugin tab to manage entitlements. This list currently shows Contact Form access.",
    Panel: ContactFormPluginAccessPanel,
  },
];
