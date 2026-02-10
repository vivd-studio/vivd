import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  integer,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";

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

// Project members - binds client_editors to specific projects
export const projectMember = pgTable(
  "project_member",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("project_member_user_idx").on(table.userId),
    index("project_member_project_idx").on(table.projectSlug),
  ]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  projectMembers: many(projectMember),
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

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  user: one(user, {
    fields: [projectMember.userId],
    references: [user.id],
  }),
}));

// Project metadata (replaces manifest.json + .vivd/project.json)
export const projectMeta = pgTable(
  "project_meta",
  {
    slug: text("slug").primaryKey(),
    source: text("source").notNull().default("scratch"), // 'url' | 'scratch'
    url: text("url").notNull().default(""),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    currentVersion: integer("current_version").notNull().default(1),
    publicPreviewEnabled: boolean("public_preview_enabled")
      .notNull()
      .default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("project_meta_slug_idx").on(table.slug)]
);

export const projectVersion = pgTable(
  "project_version",
  {
    id: text("id").primaryKey(),
    projectSlug: text("project_slug")
      .notNull()
      .references(() => projectMeta.slug, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    source: text("source").notNull().default("scratch"),
    url: text("url").notNull().default(""),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("completed"),
    startedAt: timestamp("started_at"),
    errorMessage: text("error_message"),
    thumbnailKey: text("thumbnail_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_version_project_idx").on(table.projectSlug),
    uniqueIndex("project_version_slug_version_unique").on(
      table.projectSlug,
      table.version
    ),
  ]
);

export const projectPublishChecklist = pgTable(
  "project_publish_checklist",
  {
    id: text("id").primaryKey(),
    projectSlug: text("project_slug")
      .notNull()
      .references(() => projectMeta.slug, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    runAt: timestamp("run_at").notNull(),
    snapshotCommitHash: text("snapshot_commit_hash"),
    checklist: jsonb("checklist").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_publish_checklist_project_idx").on(
      table.projectSlug,
      table.version
    ),
    uniqueIndex("project_publish_checklist_slug_version_unique").on(
      table.projectSlug,
      table.version
    ),
  ]
);

export const projectMetaRelations = relations(projectMeta, ({ many }) => ({
  versions: many(projectVersion),
  publishChecklists: many(projectPublishChecklist),
}));

export const projectVersionRelations = relations(projectVersion, ({ one, many }) => ({
  project: one(projectMeta, {
    fields: [projectVersion.projectSlug],
    references: [projectMeta.slug],
  }),
  publishChecklists: many(projectPublishChecklist),
}));

export const projectPublishChecklistRelations = relations(
  projectPublishChecklist,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [projectPublishChecklist.projectSlug],
      references: [projectMeta.slug],
    }),
    projectVersion: one(projectVersion, {
      fields: [projectPublishChecklist.projectSlug, projectPublishChecklist.version],
      references: [projectVersion.projectSlug, projectVersion.version],
    }),
  })
);

// Published sites - tracks domain to project mapping for Caddy routing
export const publishedSite = pgTable(
  "published_site",
  {
    id: text("id").primaryKey(),
    projectSlug: text("project_slug").notNull(),
    projectVersion: integer("project_version").notNull(),
    domain: text("domain").notNull().unique(), // Normalized (no www.)
    commitHash: text("commit_hash").notNull(),
    publishedAt: timestamp("published_at").notNull(),
    publishedById: text("published_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("published_site_domain_idx").on(table.domain),
    index("published_site_project_idx").on(
      table.projectSlug,
      table.projectVersion
    ),
  ]
);

export const publishedSiteRelations = relations(publishedSite, ({ one }) => ({
  publishedBy: one(user, {
    fields: [publishedSite.publishedById],
    references: [user.id],
  }),
}));

// Usage tracking - individual usage events for audit trail
export const usageRecord = pgTable(
  "usage_record",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(), // 'ai_cost' | 'image_gen'
    cost: numeric("cost", { precision: 10, scale: 6 }).notNull(), // stored in dollars, displayed as credits (×100) in frontend
    tokens: jsonb("tokens"), // token breakdown if available
    sessionId: text("session_id"), // OpenCode session ID
    sessionTitle: text("session_title"), // OpenCode session title for display
    projectSlug: text("project_slug"),
    // Idempotency key to prevent duplicate recordings (e.g., "session123:part456")
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_record_created_at_idx").on(table.createdAt),
    index("usage_record_event_type_idx").on(table.eventType),
  ]
);

// Usage tracking - rolling period aggregates for fast limit checking
export const usagePeriod = pgTable(
  "usage_period",
  {
    id: text("id").primaryKey(), // e.g., "daily:2026-01-13", "weekly:2026-W03", "monthly:2026-01"
    periodType: text("period_type").notNull(), // 'daily' | 'weekly' | 'monthly'
    periodStart: timestamp("period_start").notNull(),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    imageCount: integer("image_count").notNull().default(0),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("usage_period_type_idx").on(table.periodType),
    index("usage_period_start_idx").on(table.periodStart),
  ]
);
