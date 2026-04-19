import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ChevronRight, RotateCcw, XCircle } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Badge, Button, Callout, CalloutDescription, CalloutTitle, Collapsible, CollapsibleContent, CollapsibleTrigger, Field, FieldDescription, FieldLabel, Input, Panel, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger } from "@vivd/ui";

import type {
  EditableOrganizationRole,
  MemberEdits,
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationProject,
  OrganizationRole,
  OrganizationUserLookup,
  UserForm,
} from "../types";

type Props = {
  selectedOrg: Organization;
  projects: OrganizationProject[];
  invitations: OrganizationInvitation[];
  invitationsLoading: boolean;
  invitationsError: unknown;
  userForm: UserForm;
  setUserForm: Dispatch<SetStateAction<UserForm>>;
  existingUserLookup: OrganizationUserLookup | null;
  existingUserLookupLoading: boolean;
  existingUserLookupError: unknown;
  addExistingPending: boolean;
  addExistingError: unknown;
  onAddExistingMember: () => void;
  invitePending: boolean;
  inviteError: unknown;
  onInviteMember: () => void;
  resendInvitationPending: boolean;
  cancelInvitationPending: boolean;
  onResendInvitation: (invitationId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
  membersLoading: boolean;
  membersError: unknown;
  members: OrganizationMember[];
  memberEdits: MemberEdits;
  setMemberEdits: Dispatch<SetStateAction<MemberEdits>>;
  updateMemberRolePending: boolean;
  removeMemberPending: boolean;
  onSaveMember: (userId: string, role: EditableOrganizationRole, projectSlug?: string) => void;
  onRemoveMember: (userId: string) => void;
};

function ProjectSelect({
  value,
  onChange,
  projects,
  triggerClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  projects: OrganizationProject[];
  triggerClassName?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder="Select a project" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.slug} value={project.slug}>
            {project.title || project.slug}
          </SelectItem>
        ))}
        {projects.length === 0 ? (
          <SelectItem value="__no_projects" disabled>
            No projects
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}

function formatInviteState(state: string): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "expired":
      return "Expired";
    case "canceled":
      return "Canceled";
    case "accepted":
      return "Accepted";
    default:
      return state;
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function MembersPanel({
  selectedOrg: _selectedOrg,
  projects,
  invitations,
  invitationsLoading,
  invitationsError,
  userForm,
  setUserForm,
  existingUserLookup,
  existingUserLookupLoading,
  existingUserLookupError,
  addExistingPending,
  addExistingError,
  onAddExistingMember,
  invitePending,
  inviteError,
  onInviteMember,
  resendInvitationPending,
  cancelInvitationPending,
  onResendInvitation,
  onCancelInvitation,
  membersLoading,
  membersError,
  members,
  memberEdits,
  setMemberEdits,
  updateMemberRolePending,
  removeMemberPending,
  onSaveMember,
  onRemoveMember,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"existing" | "invite">("invite");

  const normalizedEmail = userForm.email.trim().toLowerCase();
  const lookupUser = existingUserLookup?.user ?? null;
  const existingMember = members.find(
    (member) => member.user.email.trim().toLowerCase() === normalizedEmail,
  );
  const creatingNewUser = normalizedEmail.length > 0 && !lookupUser && !existingUserLookupLoading;
  const disableAddExisting =
    addExistingPending ||
    !normalizedEmail ||
    existingUserLookupLoading ||
    Boolean(existingMember) ||
    (creatingNewUser &&
      (!userForm.name.trim() || userForm.password.trim().length < 8)) ||
    (userForm.organizationRole === "client_editor" && !userForm.projectSlug);
  const disableInvite =
    invitePending ||
    !normalizedEmail ||
    (userForm.organizationRole === "client_editor" && !userForm.projectSlug);

  return (
    <div className="space-y-4">
      <Collapsible open={addOpen} onOpenChange={setAddOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 -ml-2 px-2">
            <ChevronRight
              className={`h-4 w-4 transition-transform ${addOpen ? "rotate-90" : ""}`}
            />
            Invite or add member
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Panel className="mt-2 p-4">
            <Tabs
              value={addMode}
              onValueChange={(value) => setAddMode(value as "existing" | "invite")}
              className="space-y-4"
            >
              <TabsList variant="underline" className="w-full justify-start">
                <TabsTrigger value="invite">Invite member</TabsTrigger>
                <TabsTrigger value="existing">Add member</TabsTrigger>
              </TabsList>

              <TabsContent value="invite" className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="invite-email" required>
                      Email
                    </FieldLabel>
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="user@example.com"
                      value={userForm.email}
                      onChange={(e) =>
                        setUserForm((state) => ({
                          ...state,
                          email: e.target.value,
                        }))
                      }
                    />
                    <FieldDescription>
                      The invite email lets them create an account or sign in with an
                      existing one.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Role</FieldLabel>
                    <Select
                      value={userForm.organizationRole}
                      onValueChange={(value) =>
                        setUserForm((state) => ({
                          ...state,
                          organizationRole: value as OrganizationRole,
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
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="invite-name">Name</FieldLabel>
                    <Input
                      id="invite-name"
                      placeholder="Full name (optional)"
                      value={userForm.name}
                      onChange={(e) =>
                        setUserForm((state) => ({
                          ...state,
                          name: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  {userForm.organizationRole === "client_editor" ? (
                    <Field>
                      <FieldLabel>Assigned project</FieldLabel>
                      <ProjectSelect
                        value={userForm.projectSlug}
                        onChange={(value) =>
                          setUserForm((state) => ({
                            ...state,
                            projectSlug: value,
                          }))
                        }
                        projects={projects}
                      />
                    </Field>
                  ) : (
                    <Callout tone="info">
                      <CalloutTitle>Organization access starts after acceptance</CalloutTitle>
                      <CalloutDescription>
                        Invitees land in the organization workspace after they accept.
                      </CalloutDescription>
                    </Callout>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button onClick={onInviteMember} disabled={disableInvite}>
                    {invitePending ? "Sending..." : "Send invite"}
                  </Button>
                </div>
                {Boolean(inviteError) ? (
                  <div className="text-sm text-destructive">{String(inviteError)}</div>
                ) : null}
              </TabsContent>

              <TabsContent value="existing" className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="member-email" required>
                      Email
                    </FieldLabel>
                    <Input
                      id="member-email"
                      type="email"
                      placeholder="user@example.com"
                      value={userForm.email}
                      onChange={(e) =>
                        setUserForm((state) => ({
                          ...state,
                          email: e.target.value,
                        }))
                      }
                    />
                    <FieldDescription>
                      Add an existing account immediately, or create a new member with
                      a password.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Role</FieldLabel>
                    <Select
                      value={userForm.organizationRole}
                      onValueChange={(value) =>
                        setUserForm((state) => ({
                          ...state,
                          organizationRole: value as OrganizationRole,
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
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="member-name" required={creatingNewUser}>
                      Name
                    </FieldLabel>
                    <Input
                      id="member-name"
                      placeholder="Full name"
                      value={userForm.name}
                      onChange={(e) =>
                        setUserForm((state) => ({
                          ...state,
                          name: e.target.value,
                        }))
                      }
                    />
                    {creatingNewUser ? (
                      <FieldDescription>
                        Required when creating a new account from this panel.
                      </FieldDescription>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="member-password" required={creatingNewUser}>
                      Password
                    </FieldLabel>
                    <Input
                      id="member-password"
                      type="password"
                      placeholder="At least 8 characters"
                      value={userForm.password}
                      onChange={(e) =>
                        setUserForm((state) => ({
                          ...state,
                          password: e.target.value,
                        }))
                      }
                    />
                    {creatingNewUser ? (
                      <FieldDescription>
                        Required when no account exists yet for this email.
                      </FieldDescription>
                    ) : (
                      <FieldDescription>
                        Leave blank when attaching an existing account.
                      </FieldDescription>
                    )}
                  </Field>
                  {userForm.organizationRole === "client_editor" ? (
                    <Field>
                      <FieldLabel>Assigned project</FieldLabel>
                      <ProjectSelect
                        value={userForm.projectSlug}
                        onChange={(value) =>
                          setUserForm((state) => ({
                            ...state,
                            projectSlug: value,
                          }))
                        }
                        projects={projects}
                      />
                    </Field>
                  ) : null}
                </div>

                {normalizedEmail ? (
                  existingUserLookupError ? (
                    <Callout tone="danger">
                      <CalloutTitle>Account lookup failed</CalloutTitle>
                      <CalloutDescription>
                        {String(existingUserLookupError)}
                      </CalloutDescription>
                    </Callout>
                  ) : existingMember ? (
                    <Callout tone="warn">
                      <CalloutTitle>User is already a member</CalloutTitle>
                      <CalloutDescription>
                        {existingMember.user.email} already belongs to this organization.
                      </CalloutDescription>
                    </Callout>
                  ) : existingUserLookupLoading ? (
                    <Callout tone="info">
                      <CalloutTitle>Checking for an existing account</CalloutTitle>
                      <CalloutDescription>
                        Looking up this email before enabling direct add.
                      </CalloutDescription>
                    </Callout>
                  ) : lookupUser ? (
                    <Callout tone="success">
                      <CalloutTitle>Existing account found</CalloutTitle>
                      <CalloutDescription>
                        {lookupUser.name || lookupUser.email} will be added immediately as{" "}
                        {userForm.organizationRole === "member"
                          ? "User"
                          : userForm.organizationRole === "client_editor"
                            ? "Client Editor"
                            : userForm.organizationRole}
                        .
                      </CalloutDescription>
                    </Callout>
                  ) : (
                    <Callout tone="warn">
                      <CalloutTitle>No existing account found</CalloutTitle>
                      <CalloutDescription>
                        Fill in name and password to create the account and add the
                        member immediately.
                      </CalloutDescription>
                    </Callout>
                  )
                ) : null}

                <div className="flex justify-end">
                  <Button onClick={onAddExistingMember} disabled={disableAddExisting}>
                    {addExistingPending ? "Adding..." : "Add member"}
                  </Button>
                </div>
                {Boolean(addExistingError) ? (
                  <div className="text-sm text-destructive">
                    {String(addExistingError)}
                  </div>
                ) : null}
              </TabsContent>
            </Tabs>
          </Panel>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-2">
        <div className="text-sm font-medium">Pending invites</div>
        {invitationsLoading ? (
          <LoadingSpinner message="Loading invites..." className="justify-start" />
        ) : invitationsError ? (
          <div className="text-sm text-destructive">
            Failed to load invites: {String(invitationsError)}
          </div>
        ) : invitations.length > 0 ? (
          <Panel className="divide-y divide-border">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate font-medium">{invitation.email}</div>
                    <StatusPill
                      tone={
                        invitation.state === "pending"
                          ? "info"
                          : invitation.state === "expired"
                            ? "warn"
                            : invitation.state === "canceled"
                              ? "danger"
                              : "success"
                      }
                    >
                      {formatInviteState(invitation.state)}
                    </StatusPill>
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {invitation.role}
                    {invitation.projectTitle ? ` · ${invitation.projectTitle}` : ""}
                    {invitation.inviteeName ? ` · ${invitation.inviteeName}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sent {formatDateTime(invitation.lastSentAt)} · Expires{" "}
                    {formatDateTime(invitation.expiresAt)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resendInvitationPending}
                    onClick={() => onResendInvitation(invitation.id)}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Resend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      invitation.state === "canceled" || cancelInvitationPending
                    }
                    onClick={() => onCancelInvitation(invitation.id)}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </Panel>
        ) : (
          <Panel tone="dashed" className="px-4 py-6 text-sm text-muted-foreground">
            No pending invites.
          </Panel>
        )}
      </div>

      {membersLoading ? (
        <LoadingSpinner message="Loading members..." className="justify-start" />
      ) : membersError ? (
        <div className="text-sm text-destructive">
          Failed to load members: {String(membersError)}
        </div>
      ) : (
        <Panel className="divide-y divide-border">
          {members.map((member) => {
            const edit =
              memberEdits[member.userId] ??
              ({
                role: member.role as EditableOrganizationRole,
                projectSlug: member.assignedProjectSlug ?? "",
              } satisfies {
                role: EditableOrganizationRole;
                projectSlug: string;
              });

            const originalProjectSlug = member.assignedProjectSlug ?? "";
            const isDirty =
              edit.role !== member.role ||
              (edit.role === "client_editor" && edit.projectSlug !== originalProjectSlug);

            const canSave =
              isDirty &&
              (edit.role !== "client_editor" || Boolean(edit.projectSlug));

            return (
              <div
                key={member.id}
                className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {member.user.name || member.user.email}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {member.user.email}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Select
                    value={edit.role}
                    onValueChange={(value) =>
                      setMemberEdits((current) => ({
                        ...current,
                        [member.userId]: {
                          role: value as EditableOrganizationRole,
                          projectSlug:
                            value === "client_editor"
                              ? current[member.userId]?.projectSlug ??
                                member.assignedProjectSlug ??
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
                      <SelectItem value="owner">Owner</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">User</SelectItem>
                      <SelectItem value="client_editor">Client Editor</SelectItem>
                    </SelectContent>
                  </Select>

                  {edit.role === "client_editor" ? (
                    <ProjectSelect
                      value={edit.projectSlug}
                      onChange={(value) =>
                        setMemberEdits((current) => ({
                          ...current,
                          [member.userId]: {
                            role: "client_editor",
                            projectSlug: value,
                          },
                        }))
                      }
                      projects={projects}
                      triggerClassName="w-[220px]"
                    />
                  ) : null}

                  {member.user.role === "super_admin" ? (
                    <Badge variant="secondary">Super Admin</Badge>
                  ) : null}

                  <Button
                    size="sm"
                    disabled={!canSave || updateMemberRolePending}
                    onClick={() =>
                      onSaveMember(
                        member.userId,
                        edit.role,
                        edit.role === "client_editor" ? edit.projectSlug : undefined,
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={removeMemberPending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Remove ${member.user.email} from this organization?`,
                        )
                      ) {
                        return;
                      }
                      onRemoveMember(member.userId);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
          {members.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No members</div>
          ) : null}
        </Panel>
      )}
    </div>
  );
}
