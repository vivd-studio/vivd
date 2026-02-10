import type { RouterOutputs } from "@/lib/trpc";

export type LimitsPatch = {
  dailyCreditLimit?: number;
  weeklyCreditLimit?: number;
  monthlyCreditLimit?: number;
  imageGenPerMonth?: number;
  warningThreshold?: number;
  maxProjects?: number;
};

export type OrganizationRole = "owner" | "admin" | "member" | "client_editor";
export type EditableOrganizationRole = "admin" | "member" | "client_editor";

export type Organization =
  RouterOutputs["superadmin"]["listOrganizations"]["organizations"][number];
export type OrganizationUsage = RouterOutputs["superadmin"]["getOrganizationUsage"];
export type OrganizationMember =
  RouterOutputs["superadmin"]["listOrganizationMembers"]["members"][number];
export type OrganizationProject =
  RouterOutputs["superadmin"]["listOrganizationProjects"]["projects"][number];

export type OrgForm = {
  slug: string;
  name: string;
};

export type UserForm = {
  email: string;
  name: string;
  password: string;
  organizationRole: OrganizationRole;
  projectSlug: string;
};

export type LimitsForm = {
  dailyCreditLimit: string;
  weeklyCreditLimit: string;
  monthlyCreditLimit: string;
  imageGenPerMonth: string;
  warningThreshold: string;
  maxProjects: string;
};

export type MemberEdits = Record<
  string,
  { role: EditableOrganizationRole; projectSlug: string }
>;

export const DEFAULT_LIMITS = {
  dailyCreditLimit: 1000,
  weeklyCreditLimit: 2500,
  monthlyCreditLimit: 5000,
  imageGenPerMonth: 25,
  warningThreshold: 0.8,
  maxProjects: 0,
} as const;
