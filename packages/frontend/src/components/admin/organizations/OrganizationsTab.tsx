import { FolderKanban, Globe2, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UsageLimitsPanel } from "./components/UsageLimitsPanel";
import { MembersPanel } from "./components/MembersPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { DomainsPanel } from "./components/DomainsPanel";
import { useOrganizationsAdmin } from "./useOrganizationsAdmin";
import { toLimitsPatch } from "./utils";

type Props = {
  selectedOrgId: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOrgDeleted?: (fallbackId: string) => void;
};

type OverviewMetricCardProps = {
  label: string;
  value: string;
  helper: string;
  icon: typeof Users;
};

function OverviewMetricCard({
  label,
  value,
  helper,
  icon: Icon,
}: OverviewMetricCardProps) {
  return (
    <div className="rounded-xl border bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{helper}</p>
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
    return (
      <div className="text-muted-foreground">Organization not found.</div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    admin.selectedOrg.status === "active"
                      ? "default"
                      : "destructive"
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
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {admin.selectedOrg.name}
                  </h2>
                  {admin.selectedOrg.id === "default" ? (
                    <Badge variant="secondary">Default organization</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-mono text-foreground/80">
                    {admin.selectedOrg.slug}
                  </span>{" "}
                  manages member access, domain policy, and organization-wide
                  resource limits.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[520px] xl:grid-cols-3">
              <OverviewMetricCard
                label="Members"
                value={String(admin.selectedOrg.memberCount)}
                helper="People with access to this organization."
                icon={Users}
              />
              <OverviewMetricCard
                label="Projects"
                value={admin.projectsLoading ? "..." : String(admin.projects.length)}
                helper="Projects currently assigned to this org."
                icon={FolderKanban}
              />
              <OverviewMetricCard
                label="Domains"
                value={admin.domainsLoading ? "..." : String(admin.domains.length)}
                helper="Managed tenant hosts and publish targets."
                icon={Globe2}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="usage">
            Usage & Limits
          </TabsTrigger>
          <TabsTrigger value="members">
            Members
          </TabsTrigger>
          <TabsTrigger value="domains">
            Domains
          </TabsTrigger>
          <TabsTrigger value="settings">
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

        <TabsContent value="settings" className="mt-6 max-w-3xl space-y-4">
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
