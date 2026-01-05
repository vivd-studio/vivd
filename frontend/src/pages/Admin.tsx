import { authClient } from "@/lib/auth-client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Shield, UserPlus, Loader2, AlertCircle, Wrench } from "lucide-react";
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
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface User {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
}

const addUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["user", "admin"]),
});

type AddUserFormValues = z.infer<typeof addUserSchema>;

export default function Admin() {
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";

  const form = useForm<AddUserFormValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "user",
    },
  });

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

  const addUserMutation = useMutation({
    mutationFn: async (data: AddUserFormValues) => {
      const res = await authClient.admin.createUser({
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
      });
      if (res.error) throw res.error;
      return res.data;
    },
    onSuccess: () => {
      setIsAddUserOpen(false);
      form.reset();
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
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
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Manage system users and settings.
          </p>
        </div>
        <Button
          onClick={() => setIsAddUserOpen(!isAddUserOpen)}
          className="gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      {isAddUserOpen && (
        <Card className="animate-in slide-in-from-top-4 duration-300">
          <CardHeader>
            <CardTitle>Add New User</CardTitle>
          </CardHeader>
          <CardContent>
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
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Users ({users?.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                    Created At
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
                            ? "bg-blue-100 text-blue-800"
                            : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="p-4 align-middle text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
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
                  const ok = window.confirm(
                    "Run migration for all projects? This will move files into .vivd/."
                  );
                  if (!ok) return;
                  migrateMutation.mutate();
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
