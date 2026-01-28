import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { updateUserSchema, type UpdateUserFormValues } from "./schemas";
import type { User } from "../types";

interface Project {
  slug: string;
  title?: string | null;
}

interface EditUserDialogProps {
  user: User | null;
  projects: Project[];
  assignedProjectSlug: string | null;
  onClose: () => void;
}

export function EditUserDialog({
  user,
  projects,
  assignedProjectSlug,
  onClose,
}: EditUserDialogProps) {
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const { mutateAsync: assignUserToProject } =
    trpc.user.assignUserToProject.useMutation();
  const { mutateAsync: unassignUserFromProject } =
    trpc.user.unassignUserFromProject.useMutation();

  const form = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "user",
      projectSlug: "__unassigned__",
      newPassword: "",
    },
  });

  const selectedRole = form.watch("role");

  useEffect(() => {
    if (!user) return;
    form.reset({
      name: user.name,
      email: user.email,
      role: user.role,
      projectSlug: assignedProjectSlug ?? "__unassigned__",
      newPassword: "",
    });
  }, [user, form, assignedProjectSlug]);

  const updateUserMutation = useMutation({
    mutationFn: async (data: UpdateUserFormValues) => {
      if (!user) throw new Error("No user selected");

      const res = await authClient.admin.updateUser({
        userId: user.id,
        data: {
          name: data.name,
          email: data.email,
          role: data.role as any,
        },
      });
      if (res.error) throw res.error;

      if (data.newPassword) {
        const pwRes = await authClient.admin.setUserPassword({
          userId: user.id,
          newPassword: data.newPassword,
        });
        if (pwRes.error) throw pwRes.error;
      }

      if (data.role === "client_editor") {
        if (data.projectSlug) {
          await assignUserToProject({
            userId: user.id,
            projectSlug: data.projectSlug,
          });
        } else {
          await unassignUserFromProject({ userId: user.id });
        }
      } else {
        await unassignUserFromProject({ userId: user.id });
      }

      return res.data;
    },
    onSuccess: () => {
      toast.success("User updated");
      onClose();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      utils.user.listProjectMembers.invalidate();
    },
    onError: (err: Error) => {
      toast.error("Failed to update user", {
        description: err.message || "Unknown error",
      });
    },
  });

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => updateUserMutation.mutate(data))}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
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
                      <Input
                        type="email"
                        placeholder="john@example.com"
                        {...field}
                      />
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
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="client_editor">Client Editor</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {selectedRole === "client_editor" ? (
                <FormField
                  control={form.control}
                  name="projectSlug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assigned Project</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={
                          ((field.value as string | undefined) ??
                            "__unassigned__") as string
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a project (optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__unassigned__">Unassigned</SelectItem>
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
              ) : null}
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Leave empty to keep"
                        value={(field.value as string | undefined) ?? ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={updateUserMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateUserMutation.isPending}>
                {updateUserMutation.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
