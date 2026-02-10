export interface User {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "user" | "admin" | "client_editor";
  createdAt: string;
}

export type UserRole = User["role"];
