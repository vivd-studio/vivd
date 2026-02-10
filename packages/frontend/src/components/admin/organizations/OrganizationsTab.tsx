import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type LimitsPatch = {
  dailyCreditLimit?: number;
  weeklyCreditLimit?: number;
  monthlyCreditLimit?: number;
  imageGenPerMonth?: number;
  warningThreshold?: number;
};

type OrganizationRole = "owner" | "admin" | "member" | "client_editor";

function formatRoleLabel(role: string): string {
  return role
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

  if (daily !== undefined) patch.dailyCreditLimit = Math.max(0, daily);
  if (weekly !== undefined) patch.weeklyCreditLimit = Math.max(0, weekly);
  if (monthly !== undefined) patch.monthlyCreditLimit = Math.max(0, monthly);
  if (imageGen !== undefined) patch.imageGenPerMonth = Math.max(0, Math.floor(imageGen));
  if (warning !== undefined) patch.warningThreshold = Math.min(1, Math.max(0, warning));

  return patch;
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
  });
  const [limitsForm, setLimitsForm] = useState<Record<string, string>>({
    dailyCreditLimit: "",
    weeklyCreditLimit: "",
    monthlyCreditLimit: "",
    imageGenPerMonth: "",
    warningThreshold: "",
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

  const membersQuery = trpc.superadmin.listOrganizationMembers.useQuery(
    { organizationId: selectedOrgId },
    { enabled: Boolean(selectedOrgId) },
  );

  const usageQuery = trpc.superadmin.getOrganizationUsage.useQuery(
    { organizationId: selectedOrgId },
    { enabled: Boolean(selectedOrgId) },
  );

  const createOrg = trpc.superadmin.createOrganization.useMutation({
    onSuccess: async (result) => {
      setOrgForm({ slug: "", name: "" });
      await utils.superadmin.listOrganizations.invalidate();
      setSelectedOrgId(result.organizationId);
      toast.success("Organization created", {
        description: `Org “${result.organizationId}” is ready.`,
      });
    },
    onError: (err) => {
      toast.error("Failed to create organization", {
        description: err.message,
      });
    },
  });

  const createUser = trpc.superadmin.createOrganizationUser.useMutation({
    onSuccess: async () => {
      setUserForm({
        email: "",
        name: "",
        password: "",
        organizationRole: "admin",
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
      setLimitsForm({
        dailyCreditLimit: "",
        weeklyCreditLimit: "",
        monthlyCreditLimit: "",
        imageGenPerMonth: "",
        warningThreshold: "",
      });
      await utils.superadmin.getOrganizationUsage.invalidate({ organizationId: selectedOrgId });
      await utils.superadmin.listOrganizations.invalidate();
      toast.success("Limits updated");
    },
    onError: (err) => {
      toast.error("Failed to update limits", { description: err.message });
    },
  });

  if (isLoading) {
    return <div className="text-muted-foreground">Loading organizations…</div>;
  }

  if (error) {
    return <div className="text-red-500">Failed to load organizations: {String(error)}</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <Label>Selected organization</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger className="w-full md:w-[360px]">
                  <SelectValue placeholder="Select an organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} ({org.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedOrg && (
              <div className="flex items-center gap-2">
                <Badge variant={selectedOrg.status === "active" ? "default" : "secondary"}>
                  {selectedOrg.status}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {selectedOrg.memberCount} member{selectedOrg.memberCount === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Create organization</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="org-slug">Slug</Label>
                <Input
                  id="org-slug"
                  placeholder="acme"
                  value={orgForm.slug}
                  onChange={(e) => setOrgForm((s) => ({ ...s, slug: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  placeholder="Acme Inc."
                  value={orgForm.name}
                  onChange={(e) => setOrgForm((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end">
                <Button
                  onClick={() => createOrg.mutate(orgForm)}
                  disabled={createOrg.isPending || !orgForm.slug.trim() || !orgForm.name.trim()}
                >
                  {createOrg.isPending ? "Creating…" : "Create"}
                </Button>
            </div>
            {createOrg.error && (
              <div className="text-sm text-red-500">{String(createOrg.error.message || createOrg.error)}</div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedOrg && (
        <Card>
          <CardHeader>
            <CardTitle>Members ({selectedOrg.slug})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <div className="font-medium">Create user in org</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="admin@acme.com"
                    value={userForm.email}
                    onChange={(e) => setUserForm((s) => ({ ...s, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    placeholder="Admin"
                    value={userForm.name}
                    onChange={(e) => setUserForm((s) => ({ ...s, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={userForm.password}
                    onChange={(e) => setUserForm((s) => ({ ...s, password: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Org role</Label>
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
                      <SelectItem value="owner">owner</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="member">member</SelectItem>
                      <SelectItem value="client_editor">client_editor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    createUser.mutate({
                      organizationId: selectedOrg.id,
                      email: userForm.email,
                      name: userForm.name,
                      password: userForm.password,
                      userRole:
                        userForm.organizationRole === "client_editor"
                          ? "client_editor"
                          : "user",
                      organizationRole: userForm.organizationRole,
                    })
                  }
                  disabled={
                    createUser.isPending ||
                    !userForm.email.trim() ||
                    !userForm.name.trim() ||
                    userForm.password.length < 8
                  }
                >
                  Create user
                </Button>
              </div>
              {createUser.error && (
                <div className="text-sm text-red-500">{String(createUser.error.message || createUser.error)}</div>
              )}
            </div>

            {membersQuery.isLoading ? (
              <div className="text-muted-foreground">Loading members…</div>
            ) : membersQuery.error ? (
              <div className="text-red-500">Failed to load members: {String(membersQuery.error)}</div>
            ) : (
              <div className="rounded-lg border divide-y">
                {(membersQuery.data?.members ?? []).map((m) => (
                  <div key={m.id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {m.user.name || m.user.email}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {m.user.email}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline">{formatRoleLabel(m.role)}</Badge>
                      {m.user.role === "super_admin" && (
                        <Badge variant="secondary">Super Admin</Badge>
                      )}
                    </div>
                  </div>
                ))}
                {(membersQuery.data?.members ?? []).length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">No members</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedOrg && (
        <Card>
          <CardHeader>
            <CardTitle>Usage & Limits ({selectedOrg.slug})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {usageQuery.isLoading ? (
              <div className="text-muted-foreground">Loading usage…</div>
            ) : usageQuery.error ? (
              <div className="text-red-500">Failed to load usage: {String(usageQuery.error)}</div>
            ) : (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={usageQuery.data?.limits.blocked ? "destructive" : "default"}>
                    {usageQuery.data?.limits.blocked ? "blocked" : "ok"}
                  </Badge>
                  {usageQuery.data?.limits.imageGenBlocked && (
                    <Badge variant="secondary">image gen blocked</Badge>
                  )}
                </div>
                {(usageQuery.data?.limits.warnings ?? []).length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {usageQuery.data?.limits.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="rounded-lg border p-4 space-y-3">
              <div className="font-medium">Patch limits (credits; 0 = unlimited)</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Daily credit limit</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="1000"
                    value={limitsForm.dailyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({ ...s, dailyCreditLimit: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Weekly credit limit</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="2500"
                    value={limitsForm.weeklyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({ ...s, weeklyCreditLimit: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Monthly credit limit</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="5000"
                    value={limitsForm.monthlyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({ ...s, monthlyCreditLimit: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Image generations per month</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="25"
                    value={limitsForm.imageGenPerMonth}
                    onChange={(e) =>
                      setLimitsForm((s) => ({ ...s, imageGenPerMonth: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Warning threshold (0–1)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0.8"
                    value={limitsForm.warningThreshold}
                    onChange={(e) =>
                      setLimitsForm((s) => ({ ...s, warningThreshold: e.target.value }))
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
                  Save limits
                </Button>
              </div>
              {patchLimits.error && (
                <div className="text-sm text-red-500">{String(patchLimits.error.message || patchLimits.error)}</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
