import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type LimitsPatch = {
  dailyCreditLimit?: number;
  weeklyCreditLimit?: number;
  monthlyCreditLimit?: number;
  imageGenPerMonth?: number;
  warningThreshold?: number;
  maxProjects?: number;
};

type OrganizationRole = "owner" | "admin" | "member" | "client_editor";
type EditableOrganizationRole = "admin" | "member" | "client_editor";

function formatRoleLabel(role: string): string {
  if (role === "member") return "User";
  return role
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Format a limit value for display: 0 or non-finite = "Unlimited" */
function formatLimit(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value === 0) {
    return "Unlimited";
  }
  return Math.round(value).toLocaleString();
}

/** Format a usage value for display */
function formatUsage(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

/** Check if a limit is effectively unlimited */
function isUnlimited(value: number | undefined | null): boolean {
  return value === undefined || value === null || !Number.isFinite(value) || value === 0;
}

/** Get a safe percentage for progress bars (0-100) */
function safePercentage(current: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(current)) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

/** Default limits matching the backend LimitsService defaults */
const DEFAULT_LIMITS = {
  dailyCreditLimit: 1000,
  weeklyCreditLimit: 2500,
  monthlyCreditLimit: 5000,
  imageGenPerMonth: 25,
  warningThreshold: 0.8,
  maxProjects: 0,
} as const;

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function toLimitsPatch(input: Record<string, string>): LimitsPatch {
  const patch: LimitsPatch = {};
  const daily = parseOptionalNumber(input.dailyCreditLimit ?? "");
  const weekly = parseOptionalNumber(input.weeklyCreditLimit ?? "");
  const monthly = parseOptionalNumber(input.monthlyCreditLimit ?? "");
  const imageGen = parseOptionalNumber(input.imageGenPerMonth ?? "");
  const warning = parseOptionalNumber(input.warningThreshold ?? "");
  const maxProjects = parseOptionalNumber(input.maxProjects ?? "");

  if (daily !== undefined) patch.dailyCreditLimit = Math.max(0, daily);
  if (weekly !== undefined) patch.weeklyCreditLimit = Math.max(0, weekly);
  if (monthly !== undefined) patch.monthlyCreditLimit = Math.max(0, monthly);
  if (imageGen !== undefined) patch.imageGenPerMonth = Math.max(0, Math.floor(imageGen));
  if (warning !== undefined) patch.warningThreshold = Math.min(1, Math.max(0, warning));
  if (maxProjects !== undefined) patch.maxProjects = Math.max(0, Math.floor(maxProjects));

  return patch;
}

function UsageRow({
  label,
  current,
  limit,
}: {
  label: string;
  current: number;
  limit: number;
}) {
  const unlimited = isUnlimited(limit);
  const pct = safePercentage(current, limit);
  const isHigh = pct >= 80;
  const isExceeded = pct >= 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${isExceeded ? "text-destructive" : isHigh ? "text-orange-500" : ""}`}>
          {formatUsage(current)} / {formatLimit(limit)}
        </span>
      </div>
      {!unlimited && (
        <Progress
          value={pct}
          className={`h-1.5 ${isExceeded ? "[&>div]:bg-destructive" : isHigh ? "[&>div]:bg-orange-500" : ""}`}
        />
      )}
    </div>
  );
}

export function OrganizationsTab() {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.superadmin.listOrganizations.useQuery();
  const organizations = data?.organizations ?? [];

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [orgForm, setOrgForm] = useState({ slug: "", name: "" });
  const [userForm, setUserForm] = useState({
    email: "",
    name: "",
    password: "",
    organizationRole: "admin" as OrganizationRole,
    projectSlug: "",
  });
  const [limitsForm, setLimitsForm] = useState<Record<string, string>>({
    dailyCreditLimit: "",
    weeklyCreditLimit: "",
    monthlyCreditLimit: "",
    imageGenPerMonth: "",
    warningThreshold: "",
    maxProjects: "",
  });

  useEffect(() => {
    if (!selectedOrgId && organizations.length > 0) {
      setSelectedOrgId(organizations[0]!.id);
    }
  }, [organizations, selectedOrgId]);

  const selectedOrg = useMemo(
    () => organizations.find((o) => o.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId],
  );

  const [githubPrefixForm, setGithubPrefixForm] = useState<string>("");

  useEffect(() => {
    setGithubPrefixForm(selectedOrg?.githubRepoPrefix ?? "");
  }, [selectedOrg?.githubRepoPrefix, selectedOrgId]);

  const membersQuery = trpc.superadmin.listOrganizationMembers.useQuery(
    { organizationId: selectedOrgId },
    { enabled: Boolean(selectedOrgId) },
  );

  const usageQuery = trpc.superadmin.getOrganizationUsage.useQuery(
    { organizationId: selectedOrgId },
    { enabled: Boolean(selectedOrgId) },
  );

  const projectsQuery = trpc.superadmin.listOrganizationProjects.useQuery(
    { organizationId: selectedOrgId },
    { enabled: Boolean(selectedOrgId) },
  );

  // Pre-fill limits form from the org's stored limits, falling back to defaults
  useEffect(() => {
    if (!usageQuery.data) return;
    const u = usageQuery.data;
    const stored = (selectedOrg?.limits ?? {}) as Record<string, unknown>;

    const resolve = (key: keyof typeof DEFAULT_LIMITS, effectiveLimit: number): string => {
      const storedVal = stored[key];
      if (typeof storedVal === "number" && Number.isFinite(storedVal)) return String(storedVal);
      if (!isUnlimited(effectiveLimit)) return String(Math.round(effectiveLimit));
      return String(DEFAULT_LIMITS[key]);
    };

    setLimitsForm({
      dailyCreditLimit: resolve("dailyCreditLimit", u.limits.usage.daily.limit),
      weeklyCreditLimit: resolve("weeklyCreditLimit", u.limits.usage.weekly.limit),
      monthlyCreditLimit: resolve("monthlyCreditLimit", u.limits.usage.monthly.limit),
      imageGenPerMonth: resolve("imageGenPerMonth", u.limits.usage.imageGen.limit),
      warningThreshold: typeof stored.warningThreshold === "number"
        ? String(stored.warningThreshold)
        : String(DEFAULT_LIMITS.warningThreshold),
      maxProjects: u.maxProjects ? String(u.maxProjects) : String(DEFAULT_LIMITS.maxProjects),
    });
  }, [usageQuery.data, selectedOrgId, selectedOrg?.limits]);

  const [memberEdits, setMemberEdits] = useState<
    Record<string, { role: EditableOrganizationRole; projectSlug: string }>
  >({});

  useEffect(() => {
    setMemberEdits({});
  }, [selectedOrgId]);

  const createOrg = trpc.superadmin.createOrganization.useMutation({
    onSuccess: async (result, variables) => {
      setOrgForm({ slug: "", name: "" });
      await utils.superadmin.listOrganizations.invalidate();
      setSelectedOrgId(result.organizationId);
      toast.success("Organization created", {
        description: variables
          ? `"${variables.name}" (${variables.slug}) is ready.`
          : `Org "${result.organizationId}" is ready.`,
      });
    },
    onError: (err) => {
      toast.error("Failed to create organization", {
        description: err.message,
      });
    },
  });

  const updateMemberRole = trpc.superadmin.updateOrganizationMemberRole.useMutation({
    onSuccess: async (_data, variables) => {
      setMemberEdits((current) => {
        const next = { ...current };
        delete next[variables.userId];
        return next;
      });
      await membersQuery.refetch();
      toast.success("Member updated");
    },
    onError: (err) => {
      toast.error("Failed to update member", { description: err.message });
    },
  });

  const removeMember = trpc.superadmin.removeOrganizationMember.useMutation({
    onSuccess: async (_data, variables) => {
      setMemberEdits((current) => {
        const next = { ...current };
        delete next[variables.userId];
        return next;
      });
      await membersQuery.refetch();
      await utils.superadmin.listOrganizations.invalidate();
      toast.success("Member removed");
    },
    onError: (err) => {
      toast.error("Failed to remove member", { description: err.message });
    },
  });

  const createUser = trpc.superadmin.createOrganizationUser.useMutation({
    onSuccess: async () => {
      setUserForm({
        email: "",
        name: "",
        password: "",
        organizationRole: "admin",
        projectSlug: "",
      });
      await membersQuery.refetch();
      await utils.superadmin.listOrganizations.invalidate();
      toast.success("User created");
    },
    onError: (err) => {
      toast.error("Failed to create user", { description: err.message });
    },
  });

  const patchLimits = trpc.superadmin.patchOrganizationLimits.useMutation({
    onSuccess: async () => {
      await utils.superadmin.getOrganizationUsage.invalidate({ organizationId: selectedOrgId });
      await utils.superadmin.listOrganizations.invalidate();
      toast.success("Limits updated");
    },
    onError: (err) => {
      toast.error("Failed to update limits", { description: err.message });
    },
  });

  const saveGitHubPrefix = trpc.superadmin.setOrganizationGitHubRepoPrefix.useMutation({
    onSuccess: async () => {
      await utils.superadmin.listOrganizations.invalidate();
      toast.success("GitHub prefix updated");
    },
    onError: (err) => {
      toast.error("Failed to update GitHub prefix", { description: err.message });
    },
  });

  if (isLoading) {
    return <div className="text-muted-foreground">Loading organizations...</div>;
  }

  if (error) {
    return <div className="text-red-500">Failed to load organizations: {String(error)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Organization selector + creation */}
      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>
            Select an organization to manage or create a new one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5 flex-1 max-w-sm">
              <Label>Organization</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      <span className="flex items-center gap-2">
                        {org.name}
                        <span className="text-muted-foreground">({org.slug})</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedOrg && (
              <div className="flex items-center gap-2">
                <Badge variant={selectedOrg.status === "active" ? "default" : "destructive"}>
                  {selectedOrg.status}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {selectedOrg.memberCount} member{selectedOrg.memberCount === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="text-sm font-medium">Create new organization</div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="org-slug">Slug</Label>
                <Input
                  id="org-slug"
                  placeholder="e.g. acme"
                  value={orgForm.slug}
                  onChange={(e) => setOrgForm((s) => ({ ...s, slug: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="org-name">Display name</Label>
                <Input
                  id="org-name"
                  placeholder="e.g. Acme Inc."
                  value={orgForm.name}
                  onChange={(e) => setOrgForm((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
              <Button
                onClick={() => createOrg.mutate(orgForm)}
                disabled={createOrg.isPending || !orgForm.slug.trim() || !orgForm.name.trim()}
              >
                {createOrg.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
            {createOrg.error && (
              <div className="text-sm text-red-500">{String(createOrg.error.message || createOrg.error)}</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Selected org details */}
      {selectedOrg && (
        <Tabs defaultValue="usage">
          <TabsList>
            <TabsTrigger value="usage">Usage & Limits</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* --- Usage & Limits Tab --- */}
          <TabsContent value="usage">
            <Card>
              <CardHeader>
                <CardTitle>Usage & Limits</CardTitle>
                <CardDescription>
                  Current usage and configured limits for <strong>{selectedOrg.name}</strong>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {usageQuery.isLoading ? (
                  <div className="text-muted-foreground">Loading usage...</div>
                ) : usageQuery.error ? (
                  <div className="text-red-500">Failed to load usage: {String(usageQuery.error)}</div>
                ) : usageQuery.data && (
                  <>
                    {/* Status badges */}
                    <div className="flex items-center gap-2">
                      {usageQuery.data.limits.blocked ? (
                        <Badge variant="destructive">Blocked</Badge>
                      ) : (
                        <Badge variant="default">Active</Badge>
                      )}
                      {usageQuery.data.limits.imageGenBlocked && (
                        <Badge variant="secondary">Image gen blocked</Badge>
                      )}
                    </div>

                    {/* Warnings */}
                    {usageQuery.data.limits.warnings.length > 0 && (
                      <div className="rounded-md border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30 p-3">
                        <ul className="list-disc pl-4 text-sm text-orange-700 dark:text-orange-400 space-y-1">
                          {usageQuery.data.limits.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Usage grid */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <UsageRow
                        label="Projects"
                        current={usageQuery.data.projectCount}
                        limit={usageQuery.data.maxProjects ?? 0}
                      />
                      <UsageRow
                        label="Daily credits"
                        current={usageQuery.data.limits.usage.daily.current}
                        limit={usageQuery.data.limits.usage.daily.limit}
                      />
                      <UsageRow
                        label="Weekly credits"
                        current={usageQuery.data.limits.usage.weekly.current}
                        limit={usageQuery.data.limits.usage.weekly.limit}
                      />
                      <UsageRow
                        label="Monthly credits"
                        current={usageQuery.data.limits.usage.monthly.current}
                        limit={usageQuery.data.limits.usage.monthly.limit}
                      />
                      <UsageRow
                        label="Image generations (monthly)"
                        current={usageQuery.data.limits.usage.imageGen.current}
                        limit={usageQuery.data.limits.usage.imageGen.limit}
                      />
                    </div>

                    <Separator />

                    {/* Edit limits */}
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium">Edit limits</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Set to 0 for unlimited. Changes apply immediately.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label>Daily credit limit</Label>
                          <Input
                            inputMode="numeric"
                            value={limitsForm.dailyCreditLimit}
                            onChange={(e) =>
                              setLimitsForm((s) => ({ ...s, dailyCreditLimit: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Weekly credit limit</Label>
                          <Input
                            inputMode="numeric"
                            value={limitsForm.weeklyCreditLimit}
                            onChange={(e) =>
                              setLimitsForm((s) => ({ ...s, weeklyCreditLimit: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Monthly credit limit</Label>
                          <Input
                            inputMode="numeric"
                            value={limitsForm.monthlyCreditLimit}
                            onChange={(e) =>
                              setLimitsForm((s) => ({ ...s, monthlyCreditLimit: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Image generations / month</Label>
                          <Input
                            inputMode="numeric"
                            value={limitsForm.imageGenPerMonth}
                            onChange={(e) =>
                              setLimitsForm((s) => ({ ...s, imageGenPerMonth: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Warning threshold (0-1)</Label>
                          <Input
                            inputMode="decimal"
                            value={limitsForm.warningThreshold}
                            onChange={(e) =>
                              setLimitsForm((s) => ({ ...s, warningThreshold: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Max projects (0 = unlimited)</Label>
                          <Input
                            inputMode="numeric"
                            value={limitsForm.maxProjects}
                            onChange={(e) =>
                              setLimitsForm((s) => ({ ...s, maxProjects: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          onClick={() =>
                            patchLimits.mutate({
                              organizationId: selectedOrg.id,
                              limits: toLimitsPatch(limitsForm),
                            })
                          }
                          disabled={patchLimits.isPending}
                        >
                          {patchLimits.isPending ? "Saving..." : "Save limits"}
                        </Button>
                      </div>
                      {patchLimits.error && (
                        <div className="text-sm text-red-500">{String(patchLimits.error.message || patchLimits.error)}</div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* --- Members Tab --- */}
          <TabsContent value="members">
            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription>
                  Manage members of <strong>{selectedOrg.name}</strong>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Create user form */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="text-sm font-medium">Add new user</div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        value={userForm.email}
                        onChange={(e) => setUserForm((s) => ({ ...s, email: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input
                        placeholder="Full name"
                        value={userForm.name}
                        onChange={(e) => setUserForm((s) => ({ ...s, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Password</Label>
                      <Input
                        type="password"
                        placeholder="Min. 8 characters"
                        value={userForm.password}
                        onChange={(e) => setUserForm((s) => ({ ...s, password: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Role</Label>
                      <Select
                        value={userForm.organizationRole}
                        onValueChange={(v) =>
                          setUserForm((s) => ({
                            ...s,
                            organizationRole: v as OrganizationRole,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Owner</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">User</SelectItem>
                          <SelectItem value="client_editor">Client Editor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {userForm.organizationRole === "client_editor" && (
                      <div className="space-y-1.5">
                        <Label>Assigned project</Label>
                        <Select
                          value={userForm.projectSlug}
                          onValueChange={(v) =>
                            setUserForm((s) => ({
                              ...s,
                              projectSlug: v,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a project" />
                          </SelectTrigger>
                          <SelectContent>
                            {(projectsQuery.data?.projects ?? []).map((project) => (
                              <SelectItem key={project.slug} value={project.slug}>
                                {project.title || project.slug}
                              </SelectItem>
                            ))}
                            {(projectsQuery.data?.projects ?? []).length === 0 && (
                              <SelectItem value="__no_projects" disabled>
                                No projects
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      onClick={() =>
                        createUser.mutate({
                          organizationId: selectedOrg.id,
                          email: userForm.email,
                          name: userForm.name,
                          password: userForm.password,
                          organizationRole: userForm.organizationRole,
                          projectSlug:
                            userForm.organizationRole === "client_editor"
                              ? userForm.projectSlug
                              : undefined,
                        })
                      }
                      disabled={
                        createUser.isPending ||
                        !userForm.email.trim() ||
                        !userForm.name.trim() ||
                        userForm.password.length < 8 ||
                        (userForm.organizationRole === "client_editor" &&
                          !userForm.projectSlug)
                      }
                    >
                      {createUser.isPending ? "Creating..." : "Add user"}
                    </Button>
                  </div>
                  {createUser.error && (
                    <div className="text-sm text-red-500">{String(createUser.error.message || createUser.error)}</div>
                  )}
                </div>

                {/* Members list */}
                {membersQuery.isLoading ? (
                  <div className="text-muted-foreground">Loading members...</div>
                ) : membersQuery.error ? (
                  <div className="text-red-500">Failed to load members: {String(membersQuery.error)}</div>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {(membersQuery.data?.members ?? []).map((m) => {
                      const isOwner = m.role === "owner";
                      const edit =
                        memberEdits[m.userId] ??
                        ({
                          role: m.role as EditableOrganizationRole,
                          projectSlug: m.assignedProjectSlug ?? "",
                        } satisfies {
                          role: EditableOrganizationRole;
                          projectSlug: string;
                        });

                      const originalProjectSlug = m.assignedProjectSlug ?? "";
                      const isDirty =
                        !isOwner &&
                        (edit.role !== m.role ||
                          (edit.role === "client_editor" &&
                            edit.projectSlug !== originalProjectSlug));

                      const canSave =
                        isDirty &&
                        (edit.role !== "client_editor" || Boolean(edit.projectSlug));

                      return (
                        <div
                          key={m.id}
                          className="p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {m.user.name || m.user.email}
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              {m.user.email}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {isOwner ? (
                              <Badge variant="outline">{formatRoleLabel(m.role)}</Badge>
                            ) : (
                              <Select
                                value={edit.role}
                                onValueChange={(value) =>
                                  setMemberEdits((current) => ({
                                    ...current,
                                    [m.userId]: {
                                      role: value as EditableOrganizationRole,
                                      projectSlug:
                                        value === "client_editor"
                                          ? current[m.userId]?.projectSlug ??
                                            m.assignedProjectSlug ??
                                            ""
                                          : "",
                                    },
                                  }))
                                }
                              >
                                <SelectTrigger className="w-[160px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="member">User</SelectItem>
                                  <SelectItem value="client_editor">Client Editor</SelectItem>
                                </SelectContent>
                              </Select>
                            )}

                            {!isOwner && edit.role === "client_editor" && (
                              <Select
                                value={edit.projectSlug}
                                onValueChange={(value) =>
                                  setMemberEdits((current) => ({
                                    ...current,
                                    [m.userId]: {
                                      role: "client_editor",
                                      projectSlug: value,
                                    },
                                  }))
                                }
                              >
                                <SelectTrigger className="w-[220px]">
                                  <SelectValue placeholder="Select a project" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(projectsQuery.data?.projects ?? []).map((project) => (
                                    <SelectItem key={project.slug} value={project.slug}>
                                      {project.title || project.slug}
                                    </SelectItem>
                                  ))}
                                  {(projectsQuery.data?.projects ?? []).length === 0 && (
                                    <SelectItem value="__no_projects" disabled>
                                      No projects
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            )}

                            {m.user.role === "super_admin" && (
                              <Badge variant="secondary">Super Admin</Badge>
                            )}

                            {!isOwner && (
                              <>
                                <Button
                                  size="sm"
                                  disabled={!canSave || updateMemberRole.isPending}
                                  onClick={() =>
                                    updateMemberRole.mutate({
                                      organizationId: selectedOrg.id,
                                      userId: m.userId,
                                      role: edit.role,
                                      projectSlug:
                                        edit.role === "client_editor"
                                          ? edit.projectSlug
                                          : undefined,
                                    })
                                  }
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={removeMember.isPending}
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `Remove ${m.user.email} from this organization?`,
                                      )
                                    )
                                      return;
                                    removeMember.mutate({
                                      organizationId: selectedOrg.id,
                                      userId: m.userId,
                                    });
                                  }}
                                >
                                  Remove
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {(membersQuery.data?.members ?? []).length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground">No members</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* --- Settings Tab --- */}
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Settings</CardTitle>
                <CardDescription>
                  Configuration for <strong>{selectedOrg.name}</strong>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">GitHub repository prefix</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Prefix for auto-created repository names. A trailing "-" is added automatically if missing.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1 max-w-sm">
                      <Input
                        placeholder={selectedOrg.slug}
                        value={githubPrefixForm}
                        onChange={(e) => setGithubPrefixForm(e.target.value)}
                      />
                    </div>
                    <Button
                      onClick={() =>
                        saveGitHubPrefix.mutate({
                          organizationId: selectedOrg.id,
                          githubRepoPrefix: githubPrefixForm,
                        })
                      }
                      disabled={
                        saveGitHubPrefix.isPending ||
                        githubPrefixForm.trim() === selectedOrg.githubRepoPrefix
                      }
                    >
                      {saveGitHubPrefix.isPending ? "Saving..." : "Save prefix"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
