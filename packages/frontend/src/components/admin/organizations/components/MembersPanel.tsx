import type { Dispatch, SetStateAction } from "react";
import * as z from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import type {
  EditableOrganizationRole,
  MemberEdits,
  Organization,
  OrganizationMember,
  OrganizationProject,
  OrganizationRole,
  UserForm,
} from "../types";
import { formatRoleLabel } from "../utils";

type Props = {
  selectedOrg: Organization;
  projects: OrganizationProject[];
  userForm: UserForm;
  setUserForm: Dispatch<SetStateAction<UserForm>>;
  createUserPending: boolean;
  createUserError: unknown;
  onCreateUser: (isExistingAccount: boolean) => void;
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
        {projects.length === 0 && (
          <SelectItem value="__no_projects" disabled>
            No projects
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

export function MembersPanel({
  selectedOrg,
  projects,
  userForm,
  setUserForm,
  createUserPending,
  createUserError,
  onCreateUser,
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
  const normalizedEmail = userForm.email.trim().toLowerCase();
  const emailIsValid = z.string().email().safeParse(normalizedEmail).success;

  const emailLookup = trpc.superadmin.lookupUserByEmail.useQuery(
    { email: normalizedEmail },
    {
      enabled: emailIsValid,
      retry: false,
      staleTime: 30_000,
    },
  );

  const isExistingAccount = emailLookup.data?.exists ?? false;

  const disableAddUser =
    createUserPending ||
    !normalizedEmail ||
    (!isExistingAccount && (!userForm.name.trim() || userForm.password.length < 8)) ||
    (userForm.organizationRole === "client_editor" && !userForm.projectSlug);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Manage members of <strong>{selectedOrg.name}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted/50 p-4 space-y-3">
          <div className="text-sm font-medium">Add member</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
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
              {emailLookup.data?.exists ? (
                <div className="text-xs text-muted-foreground mt-1">
                  Existing account detected — name/password not required.
                </div>
              ) : emailLookup.isFetching ? (
                <div className="text-xs text-muted-foreground mt-1">Checking account…</div>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
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
            </div>
            {!isExistingAccount && (
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  placeholder="Full name"
                  value={userForm.name}
                  onChange={(e) =>
                    setUserForm((state) => ({
                      ...state,
                      name: e.target.value,
                    }))
                  }
                />
              </div>
            )}
            {!isExistingAccount && (
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  placeholder="Min. 8 characters"
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm((state) => ({
                      ...state,
                      password: e.target.value,
                    }))
                  }
                />
              </div>
            )}
            {userForm.organizationRole === "client_editor" && (
              <div className="space-y-1.5">
                <Label>Assigned project</Label>
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
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => onCreateUser(isExistingAccount)}
              disabled={disableAddUser}
            >
              {createUserPending ? "Creating..." : "Add user"}
            </Button>
          </div>
          {Boolean(createUserError) && (
            <div className="text-sm text-red-500">{String(createUserError)}</div>
          )}
        </div>

        {membersLoading ? (
          <div className="text-muted-foreground">Loading members...</div>
        ) : membersError ? (
          <div className="text-red-500">Failed to load members: {String(membersError)}</div>
        ) : (
          <div className="rounded-lg border divide-y">
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
                  className="p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {member.user.name || member.user.email}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
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

                    {edit.role === "client_editor" && (
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
                    )}

                    {member.user.role === "super_admin" && (
                      <Badge variant="secondary">Super Admin</Badge>
                    )}

                    <>
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
                            if (!window.confirm(`Remove ${member.user.email} from this organization?`)) {
                              return;
                            }
                            onRemoveMember(member.userId);
                          }}
                        >
                          Remove
                        </Button>
                    </>
                  </div>
                </div>
              );
            })}
            {members.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No members</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
