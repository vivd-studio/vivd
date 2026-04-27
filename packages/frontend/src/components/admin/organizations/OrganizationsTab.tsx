import { FolderKanban, Globe2, Users, type LucideIcon } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import {
  Badge,
  Panel,
  PanelContent,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@vivd/ui";

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

type CountChipProps = {
  icon: LucideIcon;
  label: string;
  value: string;
};

function CountChip({ icon: Icon, label, value }: CountChipProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">
        {value}
      </span>
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
      <div className="text-destructive">
        Failed to load organizations: {String(admin.error)}
      </div>
    );
  }

  if (!admin.selectedOrg) {
    return <div className="text-muted-foreground">Organization not found.</div>;
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelContent className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              tone={
                admin.selectedOrg.status === "active" ? "success" : "danger"
              }
            >
              {admin.selectedOrg.status}
            </StatusPill>
            {admin.usage?.limits.blocked ? (
              <StatusPill tone="danger">Credits blocked</StatusPill>
            ) : null}
            {admin.usage?.limits.imageGenBlocked ? (
              <StatusPill tone="warn">Image generation blocked</StatusPill>
            ) : null}
            {admin.selectedOrg.id === "default" ? (
              <Badge variant="outline">Default organization</Badge>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
            <div className="min-w-0 space-y-1.5">
              <h2 className="text-2xl font-semibold tracking-tight">
                {admin.selectedOrg.name}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>
                  slug{" "}
                  <span className="font-mono text-foreground/80">
                    {admin.selectedOrg.slug}
                  </span>
                </span>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span>
                  ID{" "}
                  <span className="font-mono text-foreground/80">
                    {admin.selectedOrg.id}
                  </span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:shrink-0">
              <CountChip
                icon={Users}
                label="Members"
                value={String(admin.selectedOrg.memberCount)}
              />
              <CountChip
                icon={FolderKanban}
                label="Projects"
                value={
                  admin.projectsLoading ? "…" : String(admin.projects.length)
                }
              />
              <CountChip
                icon={Globe2}
                label="Domains"
                value={
                  admin.domainsLoading ? "…" : String(admin.domains.length)
                }
              />
            </div>
          </div>
        </PanelContent>
      </Panel>

      <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
        <TabsList
          variant="underline"
          className="w-full justify-start overflow-x-auto"
        >
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
            invitations={admin.invitations}
            invitationsLoading={admin.invitationsLoading}
            invitationsError={admin.invitationsError}
            userForm={admin.userForm}
            setUserForm={admin.setUserForm}
            existingUserLookup={admin.existingUserLookup}
            existingUserLookupLoading={admin.existingUserLookupLoading}
            existingUserLookupError={
              admin.existingUserLookupError?.message ??
              admin.existingUserLookupError
            }
            addExistingPending={admin.addExistingMember.isPending}
            addExistingError={
              admin.addExistingMember.error?.message ??
              admin.addExistingMember.error
            }
            onAddExistingMember={() =>
              admin.addExistingMember.mutate({
                organizationId: admin.selectedOrg!.id,
                email: admin.userForm.email,
                name: admin.userForm.name.trim() || undefined,
                password: admin.userForm.password.trim() || undefined,
                organizationRole: admin.userForm.organizationRole,
                projectSlug:
                  admin.userForm.organizationRole === "client_editor"
                    ? admin.userForm.projectSlug
                    : undefined,
              })
            }
            invitePending={admin.inviteMember.isPending}
            inviteError={
              admin.inviteMember.error?.message ?? admin.inviteMember.error
            }
            onInviteMember={() =>
              admin.inviteMember.mutate({
                organizationId: admin.selectedOrg!.id,
                email: admin.userForm.email,
                name: admin.userForm.name.trim() || undefined,
                organizationRole: admin.userForm.organizationRole,
                projectSlug:
                  admin.userForm.organizationRole === "client_editor"
                    ? admin.userForm.projectSlug
                    : undefined,
              })
            }
            resendInvitationPending={admin.resendInvitation.isPending}
            cancelInvitationPending={admin.cancelInvitation.isPending}
            onResendInvitation={(invitationId) =>
              admin.resendInvitation.mutate({
                organizationId: admin.selectedOrg!.id,
                invitationId,
              })
            }
            onCancelInvitation={(invitationId) =>
              admin.cancelInvitation.mutate({
                organizationId: admin.selectedOrg!.id,
                invitationId,
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
