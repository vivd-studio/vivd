import { authClient } from "@/lib/auth-client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Shield, UserPlus, Loader2, AlertCircle, Database } from "lucide-react";
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

import { OpencodeDebugPanel } from "@/components/OpencodeDebugPanel";
import { trpc } from "@/lib/trpc";

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

/**
 * One-time migration card component.
 * This can be removed after the migration is complete.
 */
function MigrationCard() {
  const [migrationResult, setMigrationResult] = useState<{
    migrated: number;
    skipped: number;
    total: number;
    message: string;
  } | null>(null);

  const migrateMutation = trpc.project.migrateToVersions.useMutation({
    onSuccess: (data) => {
      setMigrationResult({
        migrated: data.migrated,
        skipped: data.skipped,
        total: data.total,
        message: data.message,
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-orange-600" />
          System Maintenance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Run the one-time migration to convert legacy projects to the new
            versioned folder structure (v1/, v2/, etc).
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => migrateMutation.mutate()}
              disabled={migrateMutation.isPending}
            >
              {migrateMutation.isPending ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  Running Migration...
                </>
              ) : (
                "Run Version Migration"
              )}
            </Button>
          </div>

          {migrateMutation.isError && (
            <div className="flex items-center gap-2 text-red-500 text-sm mt-2">
              <AlertCircle className="h-4 w-4" />
              {migrateMutation.error?.message || "Migration failed"}
            </div>
          )}

          {migrationResult && (
            <div className="mt-3 p-3 rounded-md bg-muted text-sm">
              <p className="font-medium">{migrationResult.message}</p>
              <p className="text-muted-foreground mt-1">
                Migrated: {migrationResult.migrated} | Skipped:{" "}
                {migrationResult.skipped} | Total: {migrationResult.total}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

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

      {/* System Maintenance Card */}
      <MigrationCard />

      <OpencodeDebugPanel />
    </div>
  );
}
