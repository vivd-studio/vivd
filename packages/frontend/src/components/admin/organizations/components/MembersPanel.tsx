import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ChevronRight, RotateCcw, XCircle } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  EditableOrganizationRole,
  MemberEdits,
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationProject,
  OrganizationRole,
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

  const normalizedEmail = userForm.email.trim().toLowerCase();
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
            Invite member
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Panel tone="sunken" className="mt-2 space-y-3 p-4">
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
                <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                  Invitees will land in the organization workspace after they accept.
                </div>
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
