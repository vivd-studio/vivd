import type { ReactNode } from "react";
import { FolderKanban, Globe2, Users } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DomainsPanel } from "./components/DomainsPanel";
import { MembersPanel } from "./components/MembersPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { UsageLimitsPanel } from "./components/UsageLimitsPanel";
import { useOrganizationsAdmin } from "./useOrganizationsAdmin";
import { toLimitsPatch } from "./utils";

type Props = {
  selectedOrgId: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOrgDeleted?: (fallbackId: string) => void;
};

type OverviewMetaItemProps = {
  label: string;
  value: ReactNode;
  helper: string;
};

type OverviewStatRowProps = {
  label: string;
  value: string;
  helper: string;
  icon: typeof Users;
};

function OverviewMetaItem({ label, value, helper }: OverviewMetaItemProps) {
  return (
    <div className="rounded-lg border bg-background/80 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
      <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function OverviewStatRow({
  label,
  value,
  helper,
  icon: Icon,
}: OverviewStatRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background/80 px-4 py-3">
      <div className="rounded-md bg-muted p-2 text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold tracking-tight text-foreground">
            {value}
          </dd>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
      </div>
    </div>
  );
}

export function OrganizationsTab({
  selectedOrgId,
  activeTab,
  onTabChange,
  onOrgDeleted,
}: Props) {
  const admin = useOrganizationsAdmin(selectedOrgId, onOrgDeleted);

  if (admin.isLoading) {
    return <LoadingSpinner message="Loading organization..." />;
  }

  if (admin.error) {
    return (
      <div className="text-red-500">
        Failed to load organizations: {String(admin.error)}
      </div>
    );
  }

  if (!admin.selectedOrg) {
    return <div className="text-muted-foreground">Organization not found.</div>;
  }

  const repoPrefix = admin.selectedOrg.githubRepoPrefix?.trim();

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-sm">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  admin.selectedOrg.status === "active" ? "default" : "destructive"
                }
              >
                {admin.selectedOrg.status}
              </Badge>
              {admin.usage?.limits.blocked ? (
                <Badge variant="destructive">Credits blocked</Badge>
              ) : null}
              {admin.usage?.limits.imageGenBlocked ? (
                <Badge variant="secondary">Image generation blocked</Badge>
              ) : null}
              {admin.selectedOrg.id === "default" ? (
                <Badge variant="outline">Default organization</Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">
                {admin.selectedOrg.name}
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Manage members, domains, usage budgets, and repository defaults for{" "}
                <span className="font-mono text-foreground/80">
                  {admin.selectedOrg.slug}
                </span>
                .
              </p>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <OverviewMetaItem
                label="Slug"
                value={
                  <span className="font-mono text-sm">{admin.selectedOrg.slug}</span>
                }
                helper="Used in URLs, org switching, and tenant scoping."
              />
              <OverviewMetaItem
                label="Organization ID"
                value={
                  <span className="font-mono text-sm">{admin.selectedOrg.id}</span>
                }
                helper="Stable internal identifier for admin and backend workflows."
              />
              <OverviewMetaItem
                label="Repository prefix"
                value={
                  repoPrefix ? (
                    <span className="font-mono text-sm">{repoPrefix}</span>
                  ) : (
                    "Uses slug fallback"
                  )
                }
                helper={
                  repoPrefix
                    ? "Applied to auto-created GitHub repositories for this organization."
                    : "New repositories default to the organization slug."
                }
              />
              <OverviewMetaItem
                label="Scope"
                value={
                  admin.selectedOrg.id === "default"
                    ? "Platform fallback organization"
                    : "Tenant organization"
                }
                helper={
                  admin.selectedOrg.id === "default"
                    ? "This stays available as the default tenant and cannot be deleted."
                    : "Standard org with its own members, projects, domains, and limits."
                }
              />
            </dl>
          </div>

          <div className="rounded-lg border bg-muted/10 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Workspace summary</h3>
              <p className="text-sm text-muted-foreground">
                Current footprint for this organization.
              </p>
            </div>
            <dl className="mt-4 space-y-2">
              <OverviewStatRow
                label="Members"
                value={String(admin.selectedOrg.memberCount)}
                helper="People who currently have access to this organization."
                icon={Users}
              />
              <OverviewStatRow
                label="Projects"
                value={admin.projectsLoading ? "..." : String(admin.projects.length)}
                helper="Projects assigned to this org right now."
                icon={FolderKanban}
              />
              <OverviewStatRow
                label="Domains"
                value={admin.domainsLoading ? "..." : String(admin.domains.length)}
                helper="Managed tenant hosts and publish targets."
                icon={Globe2}
              />
            </dl>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="usage" className="shrink-0">
            Usage & Limits
          </TabsTrigger>
          <TabsTrigger value="members" className="shrink-0">
            Members
          </TabsTrigger>
          <TabsTrigger value="domains" className="shrink-0">
            Domains
          </TabsTrigger>
          <TabsTrigger value="settings" className="shrink-0">
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="mt-6 space-y-4">
          <UsageLimitsPanel
            selectedOrg={admin.selectedOrg}
            usageLoading={admin.usageLoading}
            usageError={admin.usageError}
            usage={admin.usage}
            limitsForm={admin.limitsForm}
            setLimitsForm={admin.setLimitsForm}
            patchLimitsPending={admin.patchLimits.isPending}
            patchLimitsError={
              admin.patchLimits.error?.message ?? admin.patchLimits.error
            }
            onSaveLimits={(limits) =>
              admin.patchLimits.mutateAsync({
                organizationId: admin.selectedOrg!.id,
                limits: toLimitsPatch(limits),
              })
            }
          />
        </TabsContent>

        <TabsContent value="members" className="mt-6 space-y-4">
          <MembersPanel
            selectedOrg={admin.selectedOrg}
            projects={admin.projects}
            userForm={admin.userForm}
            setUserForm={admin.setUserForm}
            createUserPending={admin.createUser.isPending}
            createUserError={
              admin.createUser.error?.message ?? admin.createUser.error
            }
            onCreateUser={(isExistingAccount) =>
              admin.createUser.mutate({
                organizationId: admin.selectedOrg!.id,
                email: admin.userForm.email,
                name: isExistingAccount ? undefined : admin.userForm.name,
                password: isExistingAccount
                  ? undefined
                  : admin.userForm.password,
                organizationRole: admin.userForm.organizationRole,
                projectSlug:
                  admin.userForm.organizationRole === "client_editor"
                    ? admin.userForm.projectSlug
                    : undefined,
              })
            }
            membersLoading={admin.membersLoading}
            membersError={admin.membersError}
            members={admin.members}
            memberEdits={admin.memberEdits}
            setMemberEdits={admin.setMemberEdits}
            updateMemberRolePending={admin.updateMemberRole.isPending}
            removeMemberPending={admin.removeMember.isPending}
            onSaveMember={(userId, role, projectSlug) =>
              admin.updateMemberRole.mutate({
                organizationId: admin.selectedOrg!.id,
                userId,
                role,
                projectSlug,
              })
            }
            onRemoveMember={(userId) =>
              admin.removeMember.mutate({
                organizationId: admin.selectedOrg!.id,
                userId,
              })
            }
          />
        </TabsContent>

        <TabsContent value="domains" className="mt-6 space-y-4">
          <DomainsPanel
            selectedOrg={admin.selectedOrg}
            domains={admin.domains}
            domainsLoading={admin.domainsLoading}
            domainsError={admin.domainsError}
            addDomainPending={admin.addDomain.isPending}
            setDomainStatusPending={admin.setDomainStatus.isPending}
            setDomainUsagePending={admin.setDomainUsage.isPending}
            startDomainVerificationPending={
              admin.startDomainVerification.isPending
            }
            checkDomainVerificationPending={
              admin.checkDomainVerification.isPending
            }
            removeDomainPending={admin.removeDomain.isPending}
            onAddDomain={(input) => admin.addDomain.mutate(input)}
            onSetDomainStatus={(input) => admin.setDomainStatus.mutate(input)}
            onSetDomainUsage={(input) => admin.setDomainUsage.mutate(input)}
            onStartDomainVerification={(input) =>
              admin.startDomainVerification.mutate(input)
            }
            onCheckDomainVerification={(input) =>
              admin.checkDomainVerification.mutate(input)
            }
            onRemoveDomain={(input) => admin.removeDomain.mutate(input)}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-6 space-y-4">
          <SettingsPanel
            selectedOrg={admin.selectedOrg}
            orgNameForm={admin.orgNameForm}
            setOrgNameForm={admin.setOrgNameForm}
            renamePending={admin.renameOrg.isPending}
            onRename={() =>
              admin.renameOrg.mutate({
                organizationId: admin.selectedOrg!.id,
                name: admin.orgNameForm.trim(),
              })
            }
            githubPrefixForm={admin.githubPrefixForm}
            setGithubPrefixForm={admin.setGithubPrefixForm}
            savePending={admin.saveGitHubPrefix.isPending}
            onSave={() =>
              admin.saveGitHubPrefix.mutate({
                organizationId: admin.selectedOrg!.id,
                githubRepoPrefix: admin.githubPrefixForm,
              })
            }
            deletePending={admin.deleteOrg.isPending}
            onDelete={() =>
              admin.deleteOrg.mutate({
                organizationId: admin.selectedOrg!.id,
              })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
