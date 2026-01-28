import {
  pgTable,
  text,
  timestamp,
  boolean,
  json,
  integer,
  real,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =========================
// Better Auth tables
// =========================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  role: text("role").default("user").notNull(),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

// Enums
export const instanceStatusEnum = pgEnum("instance_status", [
  "active",
  "stopped",
  "error",
  "deploying",
]);
export const deploymentStatusEnum = pgEnum("deployment_status", [
  "pending",
  "running",
  "success",
  "failed",
]);
export const apiKeyTypeEnum = pgEnum("api_key_type", [
  "openrouter",
  "google",
  "github",
  "scraper",
]);

// Vivd Instances
export const vivdInstances = pgTable("vivd_instances", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  domain: text("domain").notNull(),
  dokployComposeId: text("dokploy_compose_id"),
  dokployProjectId: text("dokploy_project_id"),
  status: instanceStatusEnum("status").default("deploying").notNull(),

  // Configuration
  singleProjectMode: boolean("single_project_mode").default(false).notNull(),
  githubRepoPrefix: text("github_repo_prefix"),

  // Encrypted environment variables (for sensitive per-instance config)
  environmentVariables: json("environment_variables").$type<
    Record<string, string>
  >(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// API Keys (for per-instance keys in the future)
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id").references(() => vivdInstances.id, {
    onDelete: "cascade",
  }),
  keyType: apiKeyTypeEnum("key_type").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  label: text("label"), // e.g., "Production OpenRouter Key"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Shared API Keys (used across all instances)
export const sharedApiKeys = pgTable("shared_api_keys", {
  id: text("id").primaryKey(),
  keyType: apiKeyTypeEnum("key_type").notNull().unique(),
  encryptedValue: text("encrypted_value").notNull(),
  label: text("label"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Scrapers (shared scraper services)
export const scrapers = pgTable("scrapers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKey: text("api_key").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Deployments
export const deployments = pgTable("deployments", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id")
    .references(() => vivdInstances.id, { onDelete: "cascade" })
    .notNull(),
  version: text("version"), // e.g., "v1.2.3" or "latest"
  status: deploymentStatusEnum("status").default("pending").notNull(),
  triggeredBy: text("triggered_by"), // user id or "auto"
  logs: text("logs"),
  deployedAt: timestamp("deployed_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// Usage Logs (for future billing/tracking)
export const usageLogs = pgTable("usage_logs", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id")
    .references(() => vivdInstances.id, { onDelete: "cascade" })
    .notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  tokenCostUsd: real("token_cost_usd"),
  tokensUsed: integer("tokens_used"),
  model: text("model"),
  projectId: text("project_id"),
});

// Relations
export const vivdInstancesRelations = relations(vivdInstances, ({ many }) => ({
  apiKeys: many(apiKeys),
  deployments: many(deployments),
  usageLogs: many(usageLogs),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  instance: one(vivdInstances, {
    fields: [apiKeys.instanceId],
    references: [vivdInstances.id],
  }),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  instance: one(vivdInstances, {
    fields: [deployments.instanceId],
    references: [vivdInstances.id],
  }),
}));

export const usageLogsRelations = relations(usageLogs, ({ one }) => ({
  instance: one(vivdInstances, {
    fields: [usageLogs.instanceId],
    references: [vivdInstances.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// Types
export type VivdInstance = typeof vivdInstances.$inferSelect;
export type NewVivdInstance = typeof vivdInstances.$inferInsert;
export type Deployment = typeof deployments.$inferSelect;
export type UsageLog = typeof usageLogs.$inferSelect;
