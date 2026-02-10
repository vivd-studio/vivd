import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Loader2, UserPlus, Trash2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const createUserSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.enum(["member", "admin", "client_editor"]),
    projectSlug: z.string().optional(),
  })
  .refine(
    (data) => (data.role === "client_editor" ? !!data.projectSlug : true),
    {
      message: "Project is required for Client Editor",
      path: ["projectSlug"],
    },
  );

const resetMemberPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type CreateUserFormValues = z.infer<typeof createUserSchema>;
type ResetMemberPasswordFormValues = z.infer<typeof resetMemberPasswordSchema>;
type EditableMemberRole = "admin" | "member" | "client_editor";
type MemberEditState = {
  role: EditableMemberRole;
  projectSlug: string;
};
type PasswordResetTarget = {
  userId: string;
  email: string;
};

function formatRole(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "User";
    case "client_editor":
      return "Client Editor";
    default:
      return role;
  }
}

function toEditableMemberRole(role: string): EditableMemberRole {
  if (role === "admin" || role === "member" || role === "client_editor") {
    return role;
  }
  return "member";
}

export function TeamSettings() {
  const { data: session } = authClient.useSession();
  const utils = trpc.useUtils();
  const [isAdding, setIsAdding] = useState(false);
  const [memberEdits, setMemberEdits] = useState<Record<string, MemberEditState>>(
    {},
  );
  const [passwordResetTarget, setPasswordResetTarget] =
    useState<PasswordResetTarget | null>(null);

  const { data: membership } = trpc.organization.getMyMembership.useQuery();
  const isOrgAdmin = !!membership?.isOrganizationAdmin;

  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
    enabled: isOrgAdmin,
  });

  const {
    data: membersData,
    isLoading: isMembersLoading,
    error: membersError,
  } = trpc.organization.listMembers.useQuery(undefined, {
    enabled: isOrgAdmin,
  });

  const projects = useMemo(
    () => projectsData?.projects ?? [],
    [projectsData?.projects],
  );

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "member",
      projectSlug: undefined,
    },
  });
  const resetPasswordForm = useForm<ResetMemberPasswordFormValues>({
    resolver: zodResolver(resetMemberPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const selectedRole = form.watch("role");

  const createUserMutation = trpc.organization.createUser.useMutation({
    onSuccess: () => {
      toast.success("User created");
      form.reset();
      setIsAdding(false);
      utils.organization.listMembers.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to create user", { description: error.message });
    },
  });

  const removeMemberMutation = trpc.organization.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      utils.organization.listMembers.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to remove member", { description: error.message });
    },
  });

  const updateMemberRoleMutation = trpc.organization.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success("Member updated");
      utils.organization.listMembers.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update member", { description: error.message });
    },
  });
  const resetMemberPasswordMutation = trpc.organization.resetMemberPassword.useMutation({
    onSuccess: () => {
      toast.success("Password reset");
      resetPasswordForm.reset();
      setPasswordResetTarget(null);
    },
    onError: (error) => {
      toast.error("Failed to reset password", { description: error.message });
    },
  });

  const closePasswordResetDialog = () => {
    setPasswordResetTarget(null);
    resetPasswordForm.reset();
  };

  if (!isOrgAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Team</CardTitle>
            <CardDescription>Invite members to your organization.</CardDescription>
          </div>
          <Button onClick={() => setIsAdding((v) => !v)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            {isAdding ? "Close" : "Add member"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isAdding && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) =>
                createUserMutation.mutate(values),
              )}
              className="space-y-4 rounded-lg border p-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="jane@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="member">User</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="client_editor">Client Editor</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {selectedRole === "client_editor" && (
                  <FormField
                    control={form.control}
                    name="projectSlug"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned Project</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a project" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {projects.map((project) => (
                              <SelectItem key={project.slug} value={project.slug}>
                                {project.title || project.slug}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAdding(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createUserMutation.isPending}>
                  {createUserMutation.isPending ? (
                    <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  ) : null}
                  Create user
                </Button>
              </div>
            </form>
          </Form>
        )}

        {membersError && (
          <p className="text-sm text-destructive">
            Failed to load team: {membersError.message}
          </p>
        )}

        {isMembersLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading team…
          </div>
        ) : (
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm text-left">
              <thead className="[&_tr]:border-b">
                <tr className="border-b">
                  <th className="h-10 px-4 align-middle font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="h-10 px-4 align-middle font-medium text-muted-foreground">
                    Email
                  </th>
                  <th className="h-10 px-4 align-middle font-medium text-muted-foreground">
                    Role
                  </th>
                  <th className="h-10 px-4 align-middle font-medium text-muted-foreground">
                    Assigned Project
                  </th>
                  <th className="h-10 px-4 align-middle font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {(membersData?.members ?? []).map((member) => {
                  const isOwner = member.role === "owner";
                  const isSelf = member.userId === session?.user?.id;
                  const canRemove = !isOwner && !isSelf;
                  const canResetPassword = !isOwner && !isSelf;
                  const currentEdit =
                    memberEdits[member.userId] ??
                    (isOwner
                      ? null
                      : {
                          role: toEditableMemberRole(member.role),
                          projectSlug: member.assignedProjectSlug ?? "",
                        });
                  const hasRoleChanges = Boolean(
                    currentEdit &&
                      (currentEdit.role !== member.role ||
                        (currentEdit.role === "client_editor" &&
                          currentEdit.projectSlug !==
                            (member.assignedProjectSlug ?? ""))),
                  );
                  const canSaveRole = Boolean(
                    currentEdit &&
                      !isOwner &&
                      !isSelf &&
                      hasRoleChanges &&
                      (currentEdit.role !== "client_editor" ||
                        Boolean(currentEdit.projectSlug)),
                  );

                  return (
                    <tr key={member.id} className="border-b">
                      <td className="p-4 align-middle font-medium">
                        {member.user.name}
                      </td>
                      <td className="p-4 align-middle">{member.user.email}</td>
                      <td className="p-4 align-middle">
                        {isOwner || !currentEdit ? (
                          formatRole(member.role)
                        ) : (
                          <Select
                            value={currentEdit.role}
                            onValueChange={(value) =>
                              setMemberEdits((prev) => ({
                                ...prev,
                                [member.userId]: {
                                  role: value as EditableMemberRole,
                                  projectSlug: currentEdit.projectSlug,
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="w-[160px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="member">User</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="client_editor">Client Editor</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="p-4 align-middle text-muted-foreground">
                        {currentEdit?.role === "client_editor" ? (
                          <Select
                            value={currentEdit.projectSlug}
                            onValueChange={(value) =>
                              setMemberEdits((prev) => ({
                                ...prev,
                                [member.userId]: {
                                  role: currentEdit.role,
                                  projectSlug: value,
                                },
                              }))
                            }
                            disabled={isOwner}
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue placeholder="Select a project" />
                            </SelectTrigger>
                            <SelectContent>
                              {projects.map((project) => (
                                <SelectItem key={project.slug} value={project.slug}>
                                  {project.title || project.slug}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          member.assignedProjectSlug ?? "—"
                        )}
                      </td>
                      <td className="p-4 align-middle">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canSaveRole || updateMemberRoleMutation.isPending}
                            onClick={() => {
                              if (!currentEdit) return;
                              updateMemberRoleMutation.mutate({
                                userId: member.userId,
                                role: currentEdit.role,
                                projectSlug:
                                  currentEdit.role === "client_editor"
                                    ? currentEdit.projectSlug
                                    : undefined,
                              });
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canResetPassword || resetMemberPasswordMutation.isPending}
                            onClick={() => {
                              if (!canResetPassword) return;
                              setPasswordResetTarget({
                                userId: member.userId,
                                email: member.user.email,
                              });
                              resetPasswordForm.reset();
                            }}
                          >
                            <KeyRound className="h-4 w-4 mr-2" />
                            Reset Password
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!canRemove || removeMemberMutation.isPending}
                            aria-label={`Remove ${member.user.email}`}
                            onClick={() => {
                              if (!canRemove) return;
                              if (
                                !window.confirm(
                                  `Remove ${member.user.email} from this organization?`,
                                )
                              )
                                return;
                              removeMemberMutation.mutate({ userId: member.userId });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Dialog
          open={!!passwordResetTarget}
          onOpenChange={(open) => {
            if (!open) closePasswordResetDialog();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
              <DialogDescription>
                Set a new password for {passwordResetTarget?.email ?? "this member"}.
              </DialogDescription>
            </DialogHeader>
            <Form {...resetPasswordForm}>
              <form
                onSubmit={resetPasswordForm.handleSubmit((values) => {
                  if (!passwordResetTarget) return;
                  resetMemberPasswordMutation.mutate({
                    userId: passwordResetTarget.userId,
                    newPassword: values.newPassword,
                  });
                })}
                className="space-y-4"
              >
                <FormField
                  control={resetPasswordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={resetPasswordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={closePasswordResetDialog}
                    disabled={resetMemberPasswordMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={resetMemberPasswordMutation.isPending}>
                    {resetMemberPasswordMutation.isPending ? (
                      <Loader2 className="animate-spin h-4 w-4 mr-2" />
                    ) : null}
                    Reset Password
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
