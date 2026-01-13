import { authClient } from "@/lib/auth-client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import {
  Shield,
  UserPlus,
  Loader2,
  AlertCircle,
  Wrench,
  Pencil,
  Trash2,
  MoreVertical,
  Activity,
  TrendingUp,
  Image as ImageIcon,
  DollarSign,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface User {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin" | "client_editor";
  createdAt: string;
}

const addUserSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.enum(["user", "admin", "client_editor"]),
    projectSlug: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.role === "client_editor" && !data.projectSlug) {
        return false;
      }
      return true;
    },
    {
      message: "Project is required for Client Editor",
      path: ["projectSlug"],
    }
  );

type AddUserFormValues = z.infer<typeof addUserSchema>;

const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  role: z.enum(["user", "admin", "client_editor"]),
  projectSlug: z
    .string()
    .transform((val) =>
      val === "" || val === "__unassigned__" ? undefined : val
    )
    .optional(),
  newPassword: z
    .string()
    .transform((val) => {
      const trimmed = val?.trim();
      return trimmed?.length ? trimmed : undefined;
    })
    .refine((val) => !val || val.length >= 8, {
      message: "Password must be at least 8 characters",
    })
    .optional(),
});

type UpdateUserFormValues = z.infer<typeof updateUserSchema>;

export default function Admin() {
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [maintenanceConfirm, setMaintenanceConfirm] = useState<
    null | "migrateProcessFiles" | "templateAddMissing" | "templateOverwrite"
  >(null);
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";

  const { data: projectsData } = trpc.project.list.useQuery();
  const { mutateAsync: assignUserToProject } =
    trpc.user.assignUserToProject.useMutation();
  const { mutateAsync: unassignUserFromProject } =
    trpc.user.unassignUserFromProject.useMutation();
  const { data: membersData } = trpc.user.listProjectMembers.useQuery();

  const projectMap = new Map(
    membersData?.members.map((m) => [m.userId, m.projectSlug]) || []
  );

  const form = useForm<AddUserFormValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "user",
    },
  });

  const selectedRole = form.watch("role");

  const editForm = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "user",
      projectSlug: "__unassigned__",
      newPassword: "",
    },
  });
  const editSelectedRole = editForm.watch("role");

  useEffect(() => {
    if (!editingUser) return;
    const assignedSlug =
      membersData?.members.find((m) => m.userId === editingUser.id)
        ?.projectSlug ?? null;
    editForm.reset({
      name: editingUser.name,
      email: editingUser.email,
      role: editingUser.role,
      projectSlug: assignedSlug ?? "__unassigned__",
      newPassword: "",
    });
  }, [editingUser, editForm, membersData?.members]);

  const {
    data: users,
    isLoading,
    error: fetchError,
  } = useQuery<User[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await authClient.admin.listUsers({
        query: {
          limit: 100,
        },
      });
      if (res.error) throw res.error;
      return res.data.users as User[];
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async (data: UpdateUserFormValues) => {
      if (!editingUser) throw new Error("No user selected");

      const res = await authClient.admin.updateUser({
        userId: editingUser.id,
        data: {
          name: data.name,
          email: data.email,
          role: data.role as any,
        },
      });
      if (res.error) throw res.error;

      if (data.newPassword) {
        const pwRes = await authClient.admin.setUserPassword({
          userId: editingUser.id,
          newPassword: data.newPassword,
        });
        if (pwRes.error) throw pwRes.error;
      }

      if (data.role === "client_editor") {
        if (data.projectSlug) {
          await assignUserToProject({
            userId: editingUser.id,
            projectSlug: data.projectSlug,
          });
        } else {
          await unassignUserFromProject({ userId: editingUser.id });
        }
      } else {
        await unassignUserFromProject({ userId: editingUser.id });
      }

      return res.data;
    },
    onSuccess: () => {
      toast.success("User updated");
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      utils.user.listProjectMembers.invalidate();
    },
    onError: (err: Error) => {
      toast.error("Failed to update user", {
        description: err.message || "Unknown error",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await authClient.admin.removeUser({ userId });
      if (res.error) throw res.error;
      return res.data;
    },
    onSuccess: () => {
      toast.success("User deleted");
      setDeleteConfirmUser(null);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      utils.user.listProjectMembers.invalidate();
    },
    onError: (err: Error) => {
      toast.error("Failed to delete user", {
        description: err.message || "Unknown error",
      });
    },
  });

  const addUserMutation = useMutation({
    mutationFn: async (data: AddUserFormValues) => {
      const res = await authClient.admin.createUser({
        name: data.name,
        email: data.email,
        password: data.password,
        // Cast to any to support client_editor role (stored as text in DB)
        role: data.role as any,
      });
      if (res.error) throw res.error;

      // If client_editor, assign project
      if (data.role === "client_editor" && data.projectSlug) {
        if (!res.data?.user?.id) {
          throw new Error("Failed to get user ID for project assignment");
        }
        await assignUserToProject({
          userId: res.data.user.id,
          projectSlug: data.projectSlug,
        });
      }

      return res.data;
    },
    onSuccess: () => {
      setIsAddUserOpen(false);
      form.reset();
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      utils.user.listProjectMembers.invalidate();
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to create user");
    },
  });

  const onSubmit = (data: AddUserFormValues) => {
    setError("");
    addUserMutation.mutate(data);
  };

  const migrateMutation = trpc.project.migrateVivdProcessFiles.useMutation({
    onSuccess: (data) => {
      toast.success("Migration completed", {
        description: `Touched ${data.versionsTouched}/${data.versionsScanned} versions`,
      });
    },
    onError: (err: any) => {
      toast.error("Migration failed", {
        description: err?.message || "Unknown error",
      });
    },
  });

  const templateFilesMutation =
    trpc.project.migrateProjectTemplateFiles.useMutation({
      onSuccess: (data) => {
        toast.success("Template files updated", {
          description: `Touched ${data.versionsTouched}/${data.versionsScanned} versions`,
        });
      },
      onError: (err: any) => {
        toast.error("Template migration failed", {
          description: err?.message || "Unknown error",
        });
      },
    });

  const confirmConfig = (() => {
    switch (maintenanceConfirm) {
      case "migrateProcessFiles":
        return {
          title: "Run migration for all projects?",
          description:
            "This will move vivd process files into .vivd/ for all existing project versions.",
          confirmLabel: "Run Migration",
          isPending: migrateMutation.isPending,
          onConfirm: () => migrateMutation.mutate(),
        };
      case "templateAddMissing":
        return {
          title: "Add missing template files?",
          description:
            "This will add missing template files for all projects/versions.",
          confirmLabel: "Add Missing Files",
          isPending: templateFilesMutation.isPending,
          onConfirm: () => templateFilesMutation.mutate({ overwrite: false }),
        };
      case "templateOverwrite":
        return {
          title: "Overwrite template files?",
          description:
            "This will overwrite template files for all projects/versions and replace existing AGENTS.md files.",
          confirmLabel: "Overwrite Files",
          isPending: templateFilesMutation.isPending,
          onConfirm: () => templateFilesMutation.mutate({ overwrite: true }),
        };
      default:
        return null;
    }
  })();

  if (isLoading)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
      </div>
    );
  if (fetchError)
    return (
      <div className="p-10 text-red-500 flex items-center gap-2">
        <AlertCircle /> Error loading users: {String(fetchError)}
      </div>
    );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Manage system users and settings.
          </p>
        </div>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="users" className="gap-2">
            <Shield className="h-4 w-4" />
            Users
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="usage" className="gap-2">
                <Activity className="h-4 w-4" />
                Usage
              </TabsTrigger>
              <TabsTrigger value="maintenance" className="gap-2">
                <Wrench className="h-4 w-4" />
                Maintenance
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="users" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-600" />
                  Users ({users?.length})
                </CardTitle>
                <Button
                  onClick={() => setIsAddUserOpen(!isAddUserOpen)}
                  className="gap-2"
                >
                  <UserPlus className="h-4 w-4" />
                  Add User
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {isAddUserOpen && (
                <div className="rounded-lg border p-4 animate-in slide-in-from-top-4 duration-300">
                  <h3 className="font-semibold mb-4">Add New User</h3>
                  <Form {...form}>
                    <form
                      onSubmit={form.handleSubmit(onSubmit)}
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
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Password</FormLabel>
                              <FormControl>
                                <Input
                                  type="password"
                                  placeholder="••••••••"
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
                                  <SelectItem value="user">User</SelectItem>
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
                        {selectedRole === "client_editor" && (
                          <FormField
                            control={form.control}
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
                                    {projectsData?.projects.map((project) => (
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
                        )}
                      </div>

                      {error && <p className="text-red-500 text-sm">{error}</p>}

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setIsAddUserOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={addUserMutation.isPending}>
                          {addUserMutation.isPending ? (
                            <Loader2 className="animate-spin h-4 w-4 mr-2" />
                          ) : null}
                          Create User
                        </Button>
                      </div>
                    </form>
                  </Form>
                </div>
              )}

              <div className="relative w-full overflow-auto">
                <table className="w-full caption-bottom text-sm text-left">
                  <thead className="[&_tr]:border-b">
                    <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                      <th className="h-12 px-4 align-middle font-medium text-muted-foreground">
                        Name
                      </th>
                      <th className="h-12 px-4 align-middle font-medium text-muted-foreground">
                        Email
                      </th>
                      <th className="h-12 px-4 align-middle font-medium text-muted-foreground">
                        Role
                      </th>
                      <th className="h-12 px-4 align-middle font-medium text-muted-foreground">
                        Assigned Project
                      </th>
                      <th className="h-12 px-4 align-middle font-medium text-muted-foreground">
                        Created At
                      </th>
                      <th className="h-12 px-4 align-middle font-medium text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {users?.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b transition-colors hover:bg-muted/50"
                      >
                        <td className="p-4 align-middle font-medium">
                          {user.name}
                        </td>
                        <td className="p-4 align-middle">{user.email}</td>
                        <td className="p-4 align-middle">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                              user.role === "admin"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                                : user.role === "client_editor"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {user.role === "client_editor"
                              ? "Client Editor"
                              : user.role}
                          </span>
                        </td>
                        <td className="p-4 align-middle">
                          {user.role === "client_editor" ? (
                            <span className="text-sm font-medium">
                              {projectMap.get(user.id) || "—"}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 align-middle text-muted-foreground">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 align-middle">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Actions for ${user.email}`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setEditingUser(user)}
                                className="gap-2"
                              >
                                <Pencil className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={session?.user?.id === user.id}
                                onClick={() => setDeleteConfirmUser(user)}
                                className="gap-2 text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="usage" className="mt-6">
            <UsageStatsCard />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="maintenance" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-blue-600" />
                  System Maintenance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Move vivd process files (like <code>project.json</code>,{" "}
                  <code>website_text.txt</code>, screenshots) into the hidden{" "}
                  <code>.vivd/</code> folder for all existing projects.
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => {
                      setMaintenanceConfirm("migrateProcessFiles");
                    }}
                    disabled={migrateMutation.isPending}
                  >
                    {migrateMutation.isPending ? (
                      <Loader2 className="animate-spin h-4 w-4 mr-2" />
                    ) : null}
                    Run Migration
                  </Button>
                  {migrateMutation.data ? (
                    <span className="text-sm text-muted-foreground">
                      Touched {migrateMutation.data.versionsTouched}/
                      {migrateMutation.data.versionsScanned} versions
                      {migrateMutation.data.errors.length
                        ? ` • ${migrateMutation.data.errors.length} error(s)`
                        : ""}
                    </span>
                  ) : null}
                </div>
                {migrateMutation.data?.errors.length ? (
                  <div className="rounded-md border p-3 text-sm">
                    <div className="font-medium mb-2">Errors</div>
                    <ul className="space-y-1 text-muted-foreground">
                      {migrateMutation.data.errors.slice(0, 5).map((e, idx) => (
                        <li key={idx}>
                          {e.slug}: {e.error}
                        </li>
                      ))}
                    </ul>
                    {migrateMutation.data.errors.length > 5 ? (
                      <div className="text-muted-foreground mt-2">
                        …and {migrateMutation.data.errors.length - 5} more
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="border-t pt-3 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Ensure project template files (currently <code>AGENTS.md</code>)
                    exist in every project version. Use overwrite to update all
                    existing <code>AGENTS.md</code> files after changing the
                    template.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => {
                        setMaintenanceConfirm("templateAddMissing");
                      }}
                      disabled={templateFilesMutation.isPending}
                    >
                      {templateFilesMutation.isPending ? (
                        <Loader2 className="animate-spin h-4 w-4 mr-2" />
                      ) : null}
                      Add Missing Template Files
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMaintenanceConfirm("templateOverwrite");
                      }}
                      disabled={templateFilesMutation.isPending}
                    >
                      {templateFilesMutation.isPending ? (
                        <Loader2 className="animate-spin h-4 w-4 mr-2" />
                      ) : null}
                      Overwrite & Update Template Files
                    </Button>
                    {templateFilesMutation.data ? (
                      <span className="text-sm text-muted-foreground">
                        Wrote {templateFilesMutation.data.written["AGENTS.md"]}/
                        {templateFilesMutation.data.versionsScanned} versions
                        {templateFilesMutation.data.errors.length
                          ? ` • ${templateFilesMutation.data.errors.length} error(s)`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                  {templateFilesMutation.data?.errors.length ? (
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium mb-2">Errors</div>
                      <ul className="space-y-1 text-muted-foreground">
                        {templateFilesMutation.data.errors
                          .slice(0, 5)
                          .map((e, idx) => (
                            <li key={idx}>
                              {e.slug}: {e.error}
                            </li>
                          ))}
                      </ul>
                      {templateFilesMutation.data.errors.length > 5 ? (
                        <div className="text-muted-foreground mt-2">
                          …and {templateFilesMutation.data.errors.length - 5} more
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <AlertDialog
        open={maintenanceConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setMaintenanceConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmConfig?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmConfig?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmConfig?.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmConfig?.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                confirmConfig?.onConfirm();
                setMaintenanceConfirm(null);
              }}
            >
              {confirmConfig?.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working...
                </span>
              ) : (
                confirmConfig?.confirmLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!editingUser}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) => {
                updateUserMutation.mutate(data);
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
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
                  control={editForm.control}
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
                  control={editForm.control}
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
                          <SelectItem value="user">User</SelectItem>
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
                {editSelectedRole === "client_editor" ? (
                  <FormField
                    control={editForm.control}
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
                            <SelectItem value="__unassigned__">
                              Unassigned
                            </SelectItem>
                            {projectsData?.projects.map((project) => (
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
                ) : null}
                <FormField
                  control={editForm.control}
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
                  onClick={() => setEditingUser(null)}
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

      <AlertDialog
        open={!!deleteConfirmUser}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmUser(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleteConfirmUser?.email}
              </span>{" "}
              and all their sessions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUserMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteUserMutation.isPending || !deleteConfirmUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteConfirmUser) return;
                deleteUserMutation.mutate(deleteConfirmUser.id);
              }}
            >
              {deleteUserMutation.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </span>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Usage Statistics Card Component
function UsageStatsCard() {
  const { data: usageStatus, isLoading } = trpc.usage.status.useQuery(
    undefined,
    {
      refetchInterval: 30000,
    }
  );
  const { data: usageHistory } = trpc.usage.history.useQuery({ days: 30 });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-green-600" />
            Usage Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!usageStatus) {
    return null;
  }

  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;
  const formatDate = (date: unknown) => {
    if (!date) return "—";
    try {
      // Handle Date objects, ISO strings, or timestamps
      const d = date instanceof Date ? date : new Date(date as string | number);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  // Calculate daily cost breakdown from history
  const dailyCosts =
    usageHistory?.reduce((acc, record) => {
      const d = new Date(record.createdAt);
      // Use ISO date string for consistent parsing
      const dateKey = d.toISOString().split("T")[0];
      acc[dateKey] = (acc[dateKey] || 0) + parseFloat(record.cost);
      return acc;
    }, {} as Record<string, number>) || {};

  const last7Days = Object.entries(dailyCosts)
    .slice(-7)
    .map(([date, cost]) => ({ date, cost }));

  const maxDailyCost = Math.max(...last7Days.map((d) => d.cost), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-green-600" />
          Usage Statistics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Usage Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Daily Cost */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Daily Cost
              </span>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCurrency(usageStatus.usage.daily.current)}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>of {formatCurrency(usageStatus.usage.daily.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.daily.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.daily.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.daily.percentage >= 0.8
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.daily.percentage * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.daily)}
            </div>
          </div>

          {/* Weekly Cost */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Weekly Cost
              </span>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCurrency(usageStatus.usage.weekly.current)}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>of {formatCurrency(usageStatus.usage.weekly.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.weekly.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.weekly.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.weekly.percentage >= 0.8
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.weekly.percentage * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.weekly)}
            </div>
          </div>

          {/* Monthly Cost */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Monthly Cost
              </span>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCurrency(usageStatus.usage.monthly.current)}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  of {formatCurrency(usageStatus.usage.monthly.limit)}
                </span>
                <span>
                  {Math.round(usageStatus.usage.monthly.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.monthly.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.monthly.percentage >= 0.8
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.monthly.percentage * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.monthly)}
            </div>
          </div>

          {/* Image Generations */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Image Generations
              </span>
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {usageStatus.usage.imageGen.current}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>of {usageStatus.usage.imageGen.limit} this month</span>
                <span>
                  {Math.round(usageStatus.usage.imageGen.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.imageGen.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.imageGen.percentage >= 0.8
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.imageGen.percentage * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.monthly)}
            </div>
          </div>
        </div>

        {/* Warnings */}
        {usageStatus.warnings.length > 0 && (
          <div
            className={`rounded-lg p-4 ${
              usageStatus.blocked
                ? "bg-destructive/10 border-destructive/50"
                : "bg-yellow-500/10 border-yellow-500/50"
            } border`}
          >
            <div
              className={`font-medium text-sm ${
                usageStatus.blocked
                  ? "text-destructive"
                  : "text-yellow-700 dark:text-yellow-500"
              }`}
            >
              {usageStatus.blocked ? "Usage Blocked" : "Usage Warnings"}
            </div>
            <ul className="mt-2 space-y-1">
              {usageStatus.warnings.map((warning, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Last 7 Days Chart */}
        {last7Days.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              Last 7 Days
            </h4>
            <div className="flex items-end gap-2 h-32">
              {last7Days.map(({ date, cost }) => (
                <div
                  key={date}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(cost)}
                  </div>
                  <div className="w-full bg-muted rounded-t flex-1 flex items-end">
                    <div
                      className="w-full bg-primary/60 rounded-t transition-all"
                      style={{
                        height: `${(cost / maxDailyCost) * 100}%`,
                        minHeight: cost > 0 ? "4px" : "0",
                      }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground truncate w-full text-center">
                    {(() => {
                      try {
                        const d = new Date(date);
                        if (isNaN(d.getTime())) return "—";
                        return d.toLocaleDateString(undefined, {
                          weekday: "short",
                        });
                      } catch {
                        return "—";
                      }
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Session Usage */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Session Usage
          </h4>
          <SessionUsageTable days={30} />
        </div>
      </CardContent>
    </Card>
  );
}

function SessionUsageTable({ days }: { days: number }) {
  const { data: sessions, isLoading } = trpc.usage.sessions.useQuery({ days });

  const formatCurrency = (value: number) => `$${value.toFixed(4)}`;
  const formatDate = (date: unknown) => {
    if (!date) return "—";
    try {
      const d = date instanceof Date ? date : new Date(date as string | number);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border p-8 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
        No session usage recorded yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Last Active
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Session ID
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Cost
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Project
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Events
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.sessionId} className="border-t">
              <td className="px-4 py-2 text-muted-foreground">
                {formatDate(session.lastActive)}
              </td>
              <td className="px-4 py-2 font-mono text-xs">
                {session.sessionId?.slice(0, 8)}...
              </td>
              <td className="px-4 py-2 font-mono font-medium">
                {formatCurrency(session.totalCost)}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {session.projectSlug || "—"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {session.eventCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
