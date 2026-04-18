import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  Mail,
  Plug,
  Plus,
  Search,
  Server,
  Shield,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/common";
import { Badge, Button, Field, FieldLabel, Input, Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle, StatusPill, Tabs, TabsList, TabsTrigger, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@vivd/ui";

import { trpc } from "@/lib/trpc";
import { useAppConfig } from "@/lib/AppConfigContext";

type SuperAdminSection =
  | "instance"
  | "org"
  | "users"
  | "maintenance"
  | "machines"
  | "plugins"
  | "email";

const SECTION_META: Record<
  SuperAdminSection,
  { title: string; description: string }
> = {
  instance: {
    title: "Instance",
    description: "Review routing, capability gates, and instance-wide defaults.",
  },
  org: {
    title: "Organizations",
    description:
      "Provision organizations, review tenancy setup, and manage access and limits in one workspace.",
  },
  users: {
    title: "System Users",
    description:
      "Manage global user accounts and system-level roles across the control plane.",
  },
  maintenance: {
    title: "Maintenance",
    description:
      "Run repair flows and platform hygiene tasks for operational upkeep.",
  },
  machines: {
    title: "Machines",
    description:
      "Inspect runtime machine state, reconcile drift, and manage image overrides.",
  },
  plugins: {
    title: "Plugins",
    description:
      "Control plugin access policy, entitlement state, and rollout across projects.",
  },
  email: {
    title: "Email",
    description:
      "Monitor global deliverability policy, suppression behavior, and sender health.",
  },
};

function isSuperAdminSection(value: string | null): value is SuperAdminSection {
  return (
    value === "instance" ||
    value === "org" ||
    value === "users" ||
    value === "maintenance" ||
    value === "machines" ||
    value === "plugins" ||
    value === "email"
  );
}

const OrganizationsContent = lazy(() =>
  import("@/components/admin/organizations/OrganizationsTab").then((m) => ({
    default: m.OrganizationsTab,
  })),
);
const InstanceSettingsTab = lazy(() =>
  import("@/components/admin/instance/InstanceSettingsTab").then((m) => ({
    default: m.InstanceSettingsTab,
  })),
);
const UsersTab = lazy(() =>
  import("@/components/admin/users/UsersTab").then((m) => ({
    default: m.UsersTab,
  })),
);
const MaintenanceTab = lazy(() =>
  import("@/components/admin/maintenance/MaintenanceTab").then((m) => ({
    default: m.MaintenanceTab,
  })),
);
const MachinesTab = lazy(() =>
  import("@/components/admin/machines/MachinesTab").then((m) => ({
    default: m.MachinesTab,
  })),
);
const PluginsTab = lazy(() =>
  import("@/components/admin/plugins/PluginsTab").then((m) => ({
    default: m.PluginsTab,
  })),
);
const EmailTab = lazy(() =>
  import("@/components/admin/email/EmailTab").then((m) => ({
    default: m.EmailTab,
  })),
);

function ContentLoadingState() {
  return <LoadingSpinner message="Loading..." />;
}

export default function SuperAdmin() {
  const { config } = useAppConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const utils = trpc.useUtils();
  const platformAdminSectionsVisible =
    config.showPlatformAdminSections ?? (config.installProfile === "platform");
  const instanceSectionLabel =
    config.instanceSectionLabel ??
    (config.instanceAdminLabel === "Instance Settings" ? "General" : "Instance");

  const { data: orgData, isLoading: orgsLoading } =
    trpc.superadmin.listOrganizations.useQuery();
  const organizations = orgData?.organizations ?? [];

  const visibleSections: SuperAdminSection[] =
    platformAdminSectionsVisible
      ? ["instance", "org", "users", "maintenance", "machines", "plugins", "email"]
      : ["instance", "plugins", "machines", "email"];

  const rawSection = searchParams.get("section");
  const section: SuperAdminSection =
    rawSection && isSuperAdminSection(rawSection) && visibleSections.includes(rawSection)
      ? rawSection
      : visibleSections[0]!;
  const selectedOrgId = searchParams.get("org") ?? "";
  const orgTab = searchParams.get("tab") ?? "usage";
  const effectiveOrgId = selectedOrgId || organizations[0]?.id || "";

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");

  const filteredOrganizations = useMemo(() => {
    const query = organizationSearch.trim().toLowerCase();
    if (!query) return organizations;

    return organizations.filter((org) => {
      return (
        org.name.toLowerCase().includes(query) ||
        org.slug.toLowerCase().includes(query)
      );
    });
  }, [organizationSearch, organizations]);

  const activeOrganizationCount = useMemo(
    () => organizations.filter((org) => org.status === "active").length,
    [organizations],
  );

  const createOrg = trpc.superadmin.createOrganization.useMutation({
    onSuccess: async (result, variables) => {
      setCreateDialogOpen(false);
      setNewOrgSlug("");
      setNewOrgName("");
      await utils.superadmin.listOrganizations.invalidate();
      selectOrg(result.organizationId);
      toast.success("Organization created", {
        description: `"${variables.name}" (${variables.slug}) is ready.`,
      });
    },
    onError: (err) => {
      toast.error("Failed to create organization", {
        description: err.message,
      });
    },
  });

  const handleSectionChange = useCallback(
    (nextSection: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("section", nextSection);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const selectOrg = useCallback(
    (orgId: string, tab?: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("section", "org");
          next.set("org", orgId);
          if (tab) next.set("tab", tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setOrgTab = useCallback(
    (tab: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleOrgDeleted = useCallback(
    (fallbackId: string) => {
      if (fallbackId) {
        selectOrg(fallbackId);
      } else {
        setSearchParams({ section: "org" }, { replace: true });
      }
    },
    [selectOrg, setSearchParams],
  );

  const sectionMeta = SECTION_META[section];
  const sectionTitle = section === "instance" ? config.instanceAdminLabel : sectionMeta.title;

  const content = (() => {
    if (section === "instance") {
      return (
        <Suspense fallback={<ContentLoadingState />}>
          <InstanceSettingsTab />
        </Suspense>
      );
    }

    if (section === "org") {
      return (
        <div className="grid gap-6 xl:min-h-0 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
          <Panel className="xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100svh-8rem)] xl:min-h-0 xl:flex-col">
            <PanelHeader separated className="gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <PanelTitle>Organization Directory</PanelTitle>
                  <PanelDescription>
                    {organizations.length === 0
                      ? "Create your first organization to get started."
                      : `${organizations.length} organizations across the platform.`}
                  </PanelDescription>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="size-4" />
                  New
                </Button>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={organizationSearch}
                    onChange={(event) => setOrganizationSearch(event.target.value)}
                    placeholder="Search by name or slug"
                    className="pl-9"
                  />
                </div>
                {organizations.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone="success" dot>
                      {activeOrganizationCount} active
                    </StatusPill>
                    <StatusPill tone="neutral">
                      {organizations.length - activeOrganizationCount} non-active
                    </StatusPill>
                  </div>
                ) : null}
              </div>
            </PanelHeader>

            <PanelContent className="flex min-h-0 flex-1 flex-col p-0">
              {orgsLoading ? (
                <div className="px-6 py-10">
                  <LoadingSpinner
                    message="Loading organizations..."
                    className="justify-start"
                  />
                </div>
              ) : organizations.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                  <p className="text-sm font-medium">No organizations yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create an organization to start provisioning members and limits.
                  </p>
                </div>
              ) : filteredOrganizations.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm font-medium">No matches found</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a different name or slug.
                  </p>
                </div>
              ) : (
                <div className="max-h-[min(24rem,60svh)] overflow-y-auto overscroll-contain p-3 xl:min-h-0 xl:flex-1 xl:max-h-none">
                  <div className="space-y-2">
                    {filteredOrganizations.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => selectOrg(org.id)}
                        className={cn(
                          "w-full rounded-md border p-3 text-left transition-colors",
                          effectiveOrgId === org.id
                            ? "border-border bg-surface-sunken shadow-sm"
                            : "border-transparent hover:border-border hover:bg-surface-sunken/60",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              org.status === "active"
                                ? "bg-emerald-500"
                                : "bg-amber-500",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">{org.name}</span>
                              {org.id === "default" ? (
                                <Badge variant="secondary" className="text-[11px]">
                                  Default
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span className="font-mono">{org.slug}</span>
                              <span aria-hidden="true">•</span>
                              <span>
                                {org.memberCount} member
                                {org.memberCount === 1 ? "" : "s"}
                              </span>
                            </div>
                          </div>
                          <StatusPill
                            tone={org.status === "active" ? "success" : "warn"}
                          >
                            {org.status}
                          </StatusPill>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </PanelContent>
          </Panel>

          <div className="min-w-0">
            <Suspense fallback={<ContentLoadingState />}>
              {effectiveOrgId ? (
                <OrganizationsContent
                  selectedOrgId={effectiveOrgId}
                  activeTab={orgTab}
                  onTabChange={setOrgTab}
                  onOrgDeleted={handleOrgDeleted}
                />
              ) : !orgsLoading ? (
                <Panel tone="dashed">
                  <PanelContent className="flex flex-col items-center justify-center py-16 pt-16 text-center">
                    <Building2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
                    <h3 className="text-lg font-medium">No organizations</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create your first organization to start managing tenancy.
                    </p>
                    <Button
                      className="mt-4 gap-2"
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Create organization
                    </Button>
                  </PanelContent>
                </Panel>
              ) : null}
            </Suspense>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full">
        <Suspense fallback={<ContentLoadingState />}>
          {section === "users" ? <UsersTab /> : null}
          {section === "maintenance" ? <MaintenanceTab /> : null}
          {section === "machines" ? <MachinesTab /> : null}
          {section === "plugins" ? <PluginsTab /> : null}
          {section === "email" ? <EmailTab /> : null}
        </Suspense>
      </div>
    );
  })();

  return (
    <div className="w-full space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">
            {sectionTitle}
          </h1>
          <p className="mt-1 text-muted-foreground">{sectionMeta.description}</p>
        </div>

        {section === "org" && organizations.length > 0 ? (
          <div className="shrink-0 flex flex-wrap gap-2">
            <Badge variant="secondary">
              {organizations.length} org{organizations.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">{activeOrganizationCount} active</Badge>
          </div>
        ) : null}
      </div>

      <Tabs value={section} onValueChange={handleSectionChange} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="instance" className="gap-2">
            <Shield className="h-4 w-4" />
            {instanceSectionLabel}
          </TabsTrigger>
          {platformAdminSectionsVisible ? (
            <TabsTrigger value="org" className="gap-2">
              <Building2 className="h-4 w-4" />
              Organizations
            </TabsTrigger>
          ) : null}
          {platformAdminSectionsVisible ? (
            <TabsTrigger value="users" className="gap-2">
              <Shield className="h-4 w-4" />
              System Users
            </TabsTrigger>
          ) : null}
          {platformAdminSectionsVisible ? (
            <TabsTrigger value="maintenance" className="gap-2">
              <Wrench className="h-4 w-4" />
              Maintenance
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="machines" className="gap-2">
            <Server className="h-4 w-4" />
            Machines
          </TabsTrigger>
          <TabsTrigger value="plugins" className="gap-2">
            <Plug className="h-4 w-4" />
            Plugins
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-4 w-4" />
            Email
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">{content}</div>
      </Tabs>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field>
              <FieldLabel htmlFor="new-org-slug" required>
                Slug
              </FieldLabel>
              <Input
                id="new-org-slug"
                placeholder="e.g. acme"
                value={newOrgSlug}
                onChange={(e) => setNewOrgSlug(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-org-name" required>
                Display name
              </FieldLabel>
              <Input
                id="new-org-name"
                placeholder="e.g. Acme Inc."
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createOrg.mutate({
                  slug: newOrgSlug.trim(),
                  name: newOrgName.trim(),
                })
              }
              disabled={
                createOrg.isPending ||
                !newOrgSlug.trim() ||
                !newOrgName.trim()
              }
            >
              {createOrg.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
