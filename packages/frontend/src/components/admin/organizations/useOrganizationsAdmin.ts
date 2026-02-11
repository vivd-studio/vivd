import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type {
  EditableOrganizationRole,
  LimitsForm,
  MemberEdits,
  OrgForm,
  UserForm,
} from "./types";
import { DEFAULT_LIMITS } from "./types";
import { isUnlimited } from "./utils";

const EMPTY_LIMITS_FORM: LimitsForm = {
  dailyCreditLimit: "",
  weeklyCreditLimit: "",
  monthlyCreditLimit: "",
  imageGenPerMonth: "",
  warningThreshold: "",
  maxProjects: "",
};

const EMPTY_ORG_FORM: OrgForm = { slug: "", name: "" };

const EMPTY_USER_FORM: UserForm = {
  email: "",
  name: "",
  password: "",
  organizationRole: "admin",
  projectSlug: "",
};

export function useOrganizationsAdmin() {
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.superadmin.listOrganizations.useQuery();
  const organizations = data?.organizations ?? [];

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [orgForm, setOrgForm] = useState<OrgForm>(EMPTY_ORG_FORM);
  const [userForm, setUserForm] = useState<UserForm>(EMPTY_USER_FORM);
  const [limitsForm, setLimitsForm] = useState<LimitsForm>(EMPTY_LIMITS_FORM);
  const [githubPrefixForm, setGithubPrefixForm] = useState<string>("");
  const [memberEdits, setMemberEdits] = useState<MemberEdits>({});

  useEffect(() => {
    if (!selectedOrgId && organizations.length > 0) {
      setSelectedOrgId(organizations[0]!.id);
    }
  }, [organizations, selectedOrgId]);

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId],
  );

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

  useEffect(() => {
    if (!usageQuery.data) return;

    const usage = usageQuery.data;
    const stored = (selectedOrg?.limits ?? {}) as Record<string, unknown>;

    const resolve = (key: keyof typeof DEFAULT_LIMITS, effectiveLimit: number): string => {
      const storedVal = stored[key];
      if (typeof storedVal === "number" && Number.isFinite(storedVal)) return String(storedVal);
      if (!isUnlimited(effectiveLimit)) return String(Math.round(effectiveLimit));
      return String(DEFAULT_LIMITS[key]);
    };

    setLimitsForm({
      dailyCreditLimit: resolve("dailyCreditLimit", usage.limits.usage.daily.limit),
      weeklyCreditLimit: resolve("weeklyCreditLimit", usage.limits.usage.weekly.limit),
      monthlyCreditLimit: resolve("monthlyCreditLimit", usage.limits.usage.monthly.limit),
      imageGenPerMonth: resolve("imageGenPerMonth", usage.limits.usage.imageGen.limit),
      warningThreshold:
        typeof stored.warningThreshold === "number"
          ? String(stored.warningThreshold)
          : String(DEFAULT_LIMITS.warningThreshold),
      maxProjects: usage.maxProjects
        ? String(usage.maxProjects)
        : String(DEFAULT_LIMITS.maxProjects),
    });
  }, [usageQuery.data, selectedOrgId, selectedOrg?.limits]);

  useEffect(() => {
    setMemberEdits({});
  }, [selectedOrgId]);

  const createOrg = trpc.superadmin.createOrganization.useMutation({
    onSuccess: async (result, variables) => {
      setOrgForm(EMPTY_ORG_FORM);
      await utils.superadmin.listOrganizations.invalidate();
      setSelectedOrgId(result.organizationId);
      toast.success("Organization created", {
        description: variables
          ? `"${variables.name}" (${variables.slug}) is ready.`
          : `Org "${result.organizationId}" is ready.`,
      });
    },
    onError: (err) => {
      toast.error("Failed to create organization", { description: err.message });
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
    onSuccess: async (data) => {
      setUserForm(EMPTY_USER_FORM);
      await membersQuery.refetch();
      await utils.superadmin.listOrganizations.invalidate();
      toast.success(data.created ? "User created" : "Member added");
    },
    onError: (err) => {
      toast.error("Failed to create user", { description: err.message });
    },
  });

  const patchLimits = trpc.superadmin.patchOrganizationLimits.useMutation({
    onSuccess: async () => {
      if (selectedOrgId) {
        await utils.superadmin.getOrganizationUsage.invalidate({ organizationId: selectedOrgId });
      }
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

  return {
    isLoading,
    error,
    organizations,
    selectedOrg,
    selectedOrgId,
    setSelectedOrgId,
    orgForm,
    setOrgForm,
    createOrg,
    userForm,
    setUserForm,
    createUser,
    limitsForm,
    setLimitsForm,
    patchLimits,
    githubPrefixForm,
    setGithubPrefixForm,
    saveGitHubPrefix,
    memberEdits,
    setMemberEdits,
    updateMemberRole,
    removeMember,
    members: membersQuery.data?.members ?? [],
    membersLoading: membersQuery.isLoading,
    membersError: membersQuery.error,
    usage: usageQuery.data,
    usageLoading: usageQuery.isLoading,
    usageError: usageQuery.error,
    projects: projectsQuery.data?.projects ?? [],
  };
}

export type OrganizationsAdminState = ReturnType<typeof useOrganizationsAdmin>;
export type MemberEditState = Record<
  string,
  { role: EditableOrganizationRole; projectSlug: string }
>;
