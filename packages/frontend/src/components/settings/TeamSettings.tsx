import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  KeyRound,
  Loader2,
  RotateCcw,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import {
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PasswordInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vivd/ui";

const inviteMemberSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().email("Invalid email address"),
    role: z.enum(["member", "admin", "client_editor"]),
    projectSlug: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "client_editor" && !data.projectSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Project is required for Client Editor",
        path: ["projectSlug"],
      });
    }
  });

const resetMemberPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type InviteMemberFormValues = z.infer<typeof inviteMemberSchema>;
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

function getInviteStateTone(
  state: string,
): "info" | "success" | "warn" | "neutral" {
  switch (state) {
    case "pending":
      return "info";
    case "accepted":
      return "success";
    case "expired":
      return "warn";
    default:
      return "neutral";
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

export function TeamSettings() {
  const { data: session } = authClient.useSession();
  const utils = trpc.useUtils();
  const [isAdding, setIsAdding] = useState(false);
  const [memberEdits, setMemberEdits] = useState<
    Record<string, MemberEditState>
  >({});
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

  const {
    data: invitationsData,
    isLoading: isInvitationsLoading,
    error: invitationsError,
  } = trpc.organization.listInvitations.useQuery(undefined, {
    enabled: isOrgAdmin,
  });

  const projects = useMemo(
    () => projectsData?.projects ?? [],
    [projectsData?.projects],
  );

  const inviteForm = useForm<InviteMemberFormValues>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: {
      name: "",
      email: "",
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

  const selectedRole = inviteForm.watch("role");

  const inviteMemberMutation = trpc.organization.inviteMember.useMutation({
    onSuccess: async (data) => {
      toast.success(
        data.deliveryAccepted ? "Invitation sent" : "Invitation created",
        data.deliveryAccepted
          ? undefined
          : {
              description:
                "The invite is saved, but email delivery was not confirmed. You can resend it from the pending invites list.",
            },
      );
      inviteForm.reset();
      setIsAdding(false);
      await utils.organization.listInvitations.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to send invitation", { description: error.message });
    },
  });

  const resendInvitationMutation =
    trpc.organization.resendInvitation.useMutation({
      onSuccess: async (data) => {
        toast.success(
          data.deliveryAccepted ? "Invitation resent" : "Invitation refreshed",
          data.deliveryAccepted
            ? undefined
            : {
                description:
                  "The invite was refreshed, but email delivery was not confirmed. Try again after checking email configuration.",
              },
        );
        await utils.organization.listInvitations.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to resend invitation", {
          description: error.message,
        });
      },
    });

  const cancelInvitationMutation =
    trpc.organization.cancelInvitation.useMutation({
      onSuccess: async () => {
        toast.success("Invitation canceled");
        await utils.organization.listInvitations.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to cancel invitation", {
          description: error.message,
        });
      },
    });

  const removeMemberMutation = trpc.organization.removeMember.useMutation({
    onSuccess: async () => {
      toast.success("Member removed");
      await utils.organization.listMembers.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to remove member", { description: error.message });
    },
  });

  const updateMemberRoleMutation =
    trpc.organization.updateMemberRole.useMutation({
      onSuccess: async () => {
        toast.success("Member updated");
        await utils.organization.listMembers.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to update member", { description: error.message });
      },
    });

  const resetMemberPasswordMutation =
    trpc.organization.resetMemberPassword.useMutation({
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
    <Panel>
      <PanelHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <PanelTitle>Team</PanelTitle>
            <PanelDescription>
              Invite members to your organization and track pending invites.
            </PanelDescription>
          </div>
          <Button
            onClick={() => setIsAdding((value) => !value)}
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" />
            {isAdding ? "Close" : "Invite member"}
          </Button>
        </div>
      </PanelHeader>
      <PanelContent className="space-y-6">
        {isAdding ? (
          <Form {...inviteForm}>
            <Panel tone="sunken">
              <PanelContent className="p-4">
                <form
                  onSubmit={inviteForm.handleSubmit((values) =>
                    inviteMemberMutation.mutate({
                      email: values.email,
                      name: values.name?.trim() || undefined,
                      role: values.role,
                      projectSlug:
                        values.role === "client_editor"
                          ? values.projectSlug
                          : undefined,
                    }),
                  )}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={inviteForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="jane@example.com"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            The invite email lets them create an account or sign
                            in with an existing one.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={inviteForm.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a role" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="member">User</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="client_editor">
                                Client Editor
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={inviteForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Jane Doe"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormDescription>
                            Optional. Used as the greeting in the invite email.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {selectedRole === "client_editor" ? (
                      <FormField
                        control={inviteForm.control}
                        name="projectSlug"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assigned Project</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a project" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {projects.map((project) => (
                                  <SelectItem
                                    key={project.slug}
                                    value={project.slug}
                                  >
                                    {project.title || project.slug}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <Panel
                        tone="dashed"
                        className="px-4 py-3 text-sm text-muted-foreground"
                      >
                        Invitees will land in the organization workspace after
                        they accept.
                      </Panel>
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
                    <Button
                      type="submit"
                      disabled={inviteMemberMutation.isPending}
                    >
                      {inviteMemberMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Send invite
                    </Button>
                  </div>
                </form>
              </PanelContent>
            </Panel>
          </Form>
        ) : null}

        <Panel tone="sunken" className="overflow-hidden">
          <PanelHeader separated className="gap-1">
            <PanelTitle className="text-sm">Pending invites</PanelTitle>
            <PanelDescription>
              Invites stay here until the person accepts or you cancel them.
            </PanelDescription>
          </PanelHeader>

          {invitationsError ? (
            <div className="p-5 pt-0">
              <Callout tone="danger" icon={<XCircle />}>
                <CalloutTitle>Failed to load invites</CalloutTitle>
                <CalloutDescription>
                  {invitationsError.message}
                </CalloutDescription>
              </Callout>
            </div>
          ) : isInvitationsLoading ? (
            <div className="p-5 pt-0">
              <LoadingSpinner
                message="Loading invites..."
                className="justify-start"
              />
            </div>
          ) : (invitationsData?.invitations?.length ?? 0) > 0 ? (
            <div>
              {(invitationsData?.invitations ?? []).map((invitation, index) => (
                <div
                  key={invitation.id}
                  className={`flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{invitation.email}</span>
                      <StatusPill tone={getInviteStateTone(invitation.state)}>
                        {formatInviteState(invitation.state)}
                      </StatusPill>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatRole(invitation.role)}
                      {invitation.projectTitle
                        ? ` · ${invitation.projectTitle}`
                        : ""}
                      {invitation.inviteeName
                        ? ` · ${invitation.inviteeName}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Sent {formatDateTime(invitation.lastSentAt)} · Expires{" "}
                      {formatDateTime(invitation.expiresAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={resendInvitationMutation.isPending}
                      onClick={() =>
                        resendInvitationMutation.mutate({
                          invitationId: invitation.id,
                        })
                      }
                    >
                      {resendInvitationMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      )}
                      Resend
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={
                        invitation.state === "canceled" ||
                        cancelInvitationMutation.isPending
                      }
                      onClick={() =>
                        cancelInvitationMutation.mutate({
                          invitationId: invitation.id,
                        })
                      }
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5 pt-0">
              <Panel
                tone="dashed"
                className="px-4 py-6 text-sm text-muted-foreground"
              >
                No pending invites.
              </Panel>
            </div>
          )}
        </Panel>

        <Panel tone="sunken" className="overflow-hidden">
          <PanelHeader separated className="gap-1">
            <PanelTitle className="text-sm">Members</PanelTitle>
            <PanelDescription>
              Password reset stays available as a recovery path after someone
              joins.
            </PanelDescription>
          </PanelHeader>

          {membersError ? (
            <div className="p-5 pt-0">
              <Callout tone="danger" icon={<XCircle />}>
                <CalloutTitle>Failed to load team</CalloutTitle>
                <CalloutDescription>{membersError.message}</CalloutDescription>
              </Callout>
            </div>
          ) : isMembersLoading ? (
            <div className="p-5 pt-0">
              <LoadingSpinner
                message="Loading team..."
                className="justify-start"
              />
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Assigned Project</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
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
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          {member.user.name}
                        </TableCell>
                        <TableCell>{member.user.email}</TableCell>
                        <TableCell>
                          <StatusPill
                            tone={
                              member.user.emailVerified ? "success" : "warn"
                            }
                          >
                            {member.user.emailVerified
                              ? "Verified"
                              : "Unverified"}
                          </StatusPill>
                        </TableCell>
                        <TableCell>
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
                                <SelectItem value="client_editor">
                                  Client Editor
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
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
                                  <SelectItem
                                    key={project.slug}
                                    value={project.slug}
                                  >
                                    {project.title || project.slug}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            (member.assignedProjectSlug ?? "—")
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={
                                !canSaveRole ||
                                updateMemberRoleMutation.isPending
                              }
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
                              disabled={
                                !canResetPassword ||
                                resetMemberPasswordMutation.isPending
                              }
                              onClick={() => {
                                if (!canResetPassword) return;
                                setPasswordResetTarget({
                                  userId: member.userId,
                                  email: member.user.email,
                                });
                                resetPasswordForm.reset();
                              }}
                            >
                              <KeyRound className="mr-2 h-4 w-4" />
                              Reset Password
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={
                                !canRemove || removeMemberMutation.isPending
                              }
                              aria-label={`Remove ${member.user.email}`}
                              onClick={() => {
                                if (!canRemove) return;
                                if (
                                  !window.confirm(
                                    `Remove ${member.user.email} from this organization?`,
                                  )
                                ) {
                                  return;
                                }
                                removeMemberMutation.mutate({
                                  userId: member.userId,
                                });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

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
                Set a new password for{" "}
                {passwordResetTarget?.email ?? "this member"}.
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
                  <Button
                    type="submit"
                    disabled={resetMemberPasswordMutation.isPending}
                  >
                    {resetMemberPasswordMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Reset Password
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </PanelContent>
    </Panel>
  );
}
