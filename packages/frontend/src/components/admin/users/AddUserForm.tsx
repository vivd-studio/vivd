import { useState } from "react";
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
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { addUserSchema, type AddUserFormValues } from "./schemas";

interface Project {
  slug: string;
  title?: string | null;
}

interface AddUserFormProps {
  projects: Project[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function AddUserForm({ projects, onSuccess, onCancel }: AddUserFormProps) {
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const { mutateAsync: assignUserToProject } =
    trpc.user.assignUserToProject.useMutation();

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

  const addUserMutation = useMutation({
    mutationFn: async (data: AddUserFormValues) => {
      const res = await authClient.admin.createUser({
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role as any,
      });
      if (res.error) throw res.error;

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
      form.reset();
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      utils.user.listProjectMembers.invalidate();
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to create user");
    },
  });

  const onSubmit = (data: AddUserFormValues) => {
    setError("");
    addUserMutation.mutate(data);
  };

  return (
    <div className="rounded-lg border p-4 animate-in slide-in-from-top-4 duration-300">
      <h3 className="font-semibold mb-4">Add New User</h3>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
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
  );
}
