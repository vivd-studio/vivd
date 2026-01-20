import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { User } from "../types";

interface UserTableProps {
  users: User[];
  projectMap: Map<string, string>;
  currentUserId: string | undefined;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
}

export function UserTable({
  users,
  projectMap,
  currentUserId,
  onEdit,
  onDelete,
}: UserTableProps) {
  return (
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
          {users.map((user) => (
            <tr
              key={user.id}
              className="border-b transition-colors hover:bg-muted/50"
            >
              <td className="p-4 align-middle font-medium">{user.name}</td>
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
                  {user.role === "client_editor" ? "Client Editor" : user.role}
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
                      onClick={() => onEdit(user)}
                      className="gap-2"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={currentUserId === user.id}
                      onClick={() => onDelete(user)}
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
  );
}
