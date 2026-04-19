import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Panel,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vivd/ui";

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
  const getGlobalRoleLabel = (role: User["role"]): string => {
    if (role === "super_admin") return "Super Admin";
    if (role === "admin") return "User (legacy admin)";
    if (role === "client_editor") return "User (client editor)";
    return "User";
  };

  return (
    <Panel tone="sunken" className="relative overflow-auto p-0">
      <Table className="text-left">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Verified</TableHead>
            <TableHead>Global Role</TableHead>
            <TableHead>Assigned Project</TableHead>
            <TableHead>Created At</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <StatusPill tone={user.emailVerified ? "success" : "warn"}>
                  {user.emailVerified ? "Verified" : "Unverified"}
                </StatusPill>
              </TableCell>
              <TableCell>
                <StatusPill
                  tone={user.role === "super_admin" ? "info" : "neutral"}
                >
                  {getGlobalRoleLabel(user.role)}
                </StatusPill>
              </TableCell>
              <TableCell>
                {user.role === "client_editor" ? (
                  <span className="text-sm font-medium">
                    {projectMap.get(user.id) || "—"}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(user.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
