import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationsSelectorCard } from "./components/OrganizationsSelectorCard";
import { UsageLimitsPanel } from "./components/UsageLimitsPanel";
import { MembersPanel } from "./components/MembersPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { useOrganizationsAdmin } from "./useOrganizationsAdmin";
import { toLimitsPatch } from "./utils";

export function OrganizationsTab() {
  const admin = useOrganizationsAdmin();

  if (admin.isLoading) {
    return <div className="text-muted-foreground">Loading organizations...</div>;
  }

  if (admin.error) {
    return <div className="text-red-500">Failed to load organizations: {String(admin.error)}</div>;
  }

  return (
    <div className="space-y-6">
      <OrganizationsSelectorCard
        organizations={admin.organizations}
        selectedOrgId={admin.selectedOrgId}
        onSelectOrg={admin.setSelectedOrgId}
        selectedOrg={admin.selectedOrg}
        orgForm={admin.orgForm}
        onOrgFormChange={admin.setOrgForm}
        onCreateOrg={() => admin.createOrg.mutate(admin.orgForm)}
        createOrgPending={admin.createOrg.isPending}
        createOrgError={admin.createOrg.error?.message ?? admin.createOrg.error}
      />

      {admin.selectedOrg && (
        <Tabs defaultValue="usage">
          <TabsList>
            <TabsTrigger value="usage">Usage & Limits</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="usage">
            <UsageLimitsPanel
              selectedOrg={admin.selectedOrg}
              usageLoading={admin.usageLoading}
              usageError={admin.usageError}
              usage={admin.usage}
              limitsForm={admin.limitsForm}
              setLimitsForm={admin.setLimitsForm}
              patchLimitsPending={admin.patchLimits.isPending}
              patchLimitsError={admin.patchLimits.error?.message ?? admin.patchLimits.error}
              onSaveLimits={(limits) =>
                admin.patchLimits.mutate({
                  organizationId: admin.selectedOrg!.id,
                  limits: toLimitsPatch(limits),
                })
              }
            />
          </TabsContent>

          <TabsContent value="members">
            <MembersPanel
              selectedOrg={admin.selectedOrg}
              projects={admin.projects}
              userForm={admin.userForm}
              setUserForm={admin.setUserForm}
              createUserPending={admin.createUser.isPending}
              createUserError={admin.createUser.error?.message ?? admin.createUser.error}
              onCreateUser={(isExistingAccount) =>
                admin.createUser.mutate({
                  organizationId: admin.selectedOrg!.id,
                  email: admin.userForm.email,
                  name: isExistingAccount ? undefined : admin.userForm.name,
                  password: isExistingAccount ? undefined : admin.userForm.password,
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

          <TabsContent value="settings">
            <SettingsPanel
              selectedOrg={admin.selectedOrg}
              githubPrefixForm={admin.githubPrefixForm}
              setGithubPrefixForm={admin.setGithubPrefixForm}
              savePending={admin.saveGitHubPrefix.isPending}
              onSave={() =>
                admin.saveGitHubPrefix.mutate({
                  organizationId: admin.selectedOrg!.id,
                  githubRepoPrefix: admin.githubPrefixForm,
                })
              }
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
