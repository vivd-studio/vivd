import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, UserPlus, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { AddUserForm } from "./AddUserForm";
import { UserTable } from "./UserTable";
import { EditUserDialog } from "./EditUserDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";
import type { User } from "../types";

export function UsersTab() {
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<User | null>(null);

  const { data: session } = authClient.useSession();
  const { data: membersData } = trpc.user.listProjectMembers.useQuery();

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

  const projectMap = new Map(
    membersData?.members.map((m) => [m.userId, m.projectSlug]) || [],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-10 text-red-500 flex items-center gap-2">
        <AlertCircle /> Error loading users: {String(fetchError)}
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                Users ({users?.length})
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Global roles are system-wide. Organization roles are managed per org.
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
        </CardHeader>
        <CardContent className="space-y-6">
          {isAddUserOpen && (
            <AddUserForm
              onSuccess={() => setIsAddUserOpen(false)}
              onCancel={() => setIsAddUserOpen(false)}
            />
          )}

          {users && (
            <UserTable
              users={users}
              projectMap={projectMap}
              currentUserId={session?.user?.id}
              onEdit={setEditingUser}
              onDelete={setDeleteConfirmUser}
            />
          )}
        </CardContent>
      </Card>

      <EditUserDialog
        user={editingUser}
        onClose={() => setEditingUser(null)}
      />

      <DeleteUserDialog
        user={deleteConfirmUser}
        onClose={() => setDeleteConfirmUser(null)}
      />
    </>
  );
}
