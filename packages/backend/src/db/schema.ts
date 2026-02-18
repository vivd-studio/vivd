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
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // 'active' | 'suspended'
    limits: jsonb("limits").notNull().default({}),
    githubRepoPrefix: text("github_repo_prefix").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_slug_unique").on(table.slug),
    index("organization_status_idx").on(table.status),
  ],
);

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
    activeOrganizationId: text("active_organization_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("session_userId_idx").on(table.userId),
    index("session_active_org_idx").on(table.activeOrganizationId),
  ],
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

export const systemSetting = pgTable("system_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const organizationMember = pgTable(
  "organization_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'owner' | 'admin' | 'member' | 'client_editor'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_member_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_member_org_idx").on(table.organizationId),
    index("organization_member_user_idx").on(table.userId),
  ],
);

export const organizationInvitation = pgTable(
  "organization_invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'accepted' | 'rejected' | 'canceled'
    inviterId: text("inviter_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_invitation_org_idx").on(table.organizationId),
    index("organization_invitation_email_idx").on(table.email),
    index("organization_invitation_status_idx").on(table.status),
  ],
);

// Project members - binds client_editors to specific projects
export const projectMember = pgTable(
  "project_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_member_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("project_member_user_idx").on(table.userId),
    index("project_member_project_idx").on(table.organizationId, table.projectSlug),
  ]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  projectMembers: many(projectMember),
  organizationMembers: many(organizationMember),
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
  organization: one(organization, {
    fields: [projectMember.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [projectMember.userId],
    references: [user.id],
  }),
}));

// Project metadata (replaces manifest.json + .vivd/project.json)
export const projectMeta = pgTable(
  "project_meta",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
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
  (table) => [
    primaryKey({ columns: [table.organizationId, table.slug] }),
    index("project_meta_org_slug_idx").on(table.organizationId, table.slug),
    index("project_meta_org_updated_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
  ]
);

export const projectVersion = pgTable(
  "project_version",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
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
    foreignKey({
      columns: [table.organizationId, table.projectSlug],
      foreignColumns: [projectMeta.organizationId, projectMeta.slug],
    }).onDelete("cascade"),
    index("project_version_org_project_idx").on(
      table.organizationId,
      table.projectSlug,
    ),
    uniqueIndex("project_version_org_slug_version_unique").on(
      table.organizationId,
      table.projectSlug,
      table.version,
    ),
  ]
);

export const projectPublishChecklist = pgTable(
  "project_publish_checklist",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
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
    foreignKey({
      columns: [table.organizationId, table.projectSlug],
      foreignColumns: [projectMeta.organizationId, projectMeta.slug],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.projectSlug, table.version],
      foreignColumns: [
        projectVersion.organizationId,
        projectVersion.projectSlug,
        projectVersion.version,
      ],
    }).onDelete("cascade"),
    index("project_publish_checklist_org_project_idx").on(
      table.organizationId,
      table.projectSlug,
      table.version,
    ),
    uniqueIndex("project_publish_checklist_org_slug_version_unique").on(
      table.organizationId,
      table.projectSlug,
      table.version,
    ),
  ]
);

export const projectMetaRelations = relations(projectMeta, ({ many }) => ({
  versions: many(projectVersion),
  publishChecklists: many(projectPublishChecklist),
}));

export const projectVersionRelations = relations(
  projectVersion,
  ({ one, many }) => ({
    project: one(projectMeta, {
      fields: [projectVersion.organizationId, projectVersion.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    publishChecklists: many(projectPublishChecklist),
  }),
);

export const projectPublishChecklistRelations = relations(
  projectPublishChecklist,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [
        projectPublishChecklist.organizationId,
        projectPublishChecklist.projectSlug,
      ],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    projectVersion: one(projectVersion, {
      fields: [
        projectPublishChecklist.organizationId,
        projectPublishChecklist.projectSlug,
        projectPublishChecklist.version,
      ],
      references: [
        projectVersion.organizationId,
        projectVersion.projectSlug,
        projectVersion.version,
      ],
    }),
  })
);

// Published sites - tracks domain to project mapping for Caddy routing
export const publishedSite = pgTable(
  "published_site",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
      table.organizationId,
      table.projectSlug,
      table.projectVersion
    ),
    index("published_site_org_idx").on(table.organizationId),
  ]
);

export const publishedSiteRelations = relations(publishedSite, ({ one }) => ({
  publishedBy: one(user, {
    fields: [publishedSite.publishedById],
    references: [user.id],
  }),
}));

// Domain registry - governs host routing and publish permissions per organization.
export const domain = pgTable(
  "domain",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(), // Normalized lowercase (no www.)
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'managed_subdomain' | 'custom_domain'
    usage: text("usage").notNull(), // 'tenant_host' | 'publish_target'
    status: text("status").notNull(), // 'active' | 'disabled' | 'pending_verification'
    verificationMethod: text("verification_method"), // 'dns_txt' | 'http_file' | null
    verificationToken: text("verification_token"),
    verifiedAt: timestamp("verified_at"),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("domain_domain_unique").on(table.domain),
    index("domain_org_usage_status_idx").on(
      table.organizationId,
      table.usage,
      table.status,
    ),
    index("domain_org_type_idx").on(table.organizationId, table.type),
  ],
);

export const domainRelations = relations(domain, ({ one }) => ({
  organization: one(organization, {
    fields: [domain.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [domain.createdById],
    references: [user.id],
  }),
}));

// Usage tracking - individual usage events for audit trail
export const usageRecord = pgTable(
  "usage_record",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
    index("usage_record_org_idx").on(table.organizationId),
  ]
);

// Usage tracking - rolling period aggregates for fast limit checking
export const usagePeriod = pgTable(
  "usage_period",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    id: text("id").notNull(), // e.g., "daily:2026-01-13", "weekly:2026-W03", "monthly:2026-01"
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
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("usage_period_type_idx").on(table.periodType),
    index("usage_period_start_idx").on(table.periodStart),
    index("usage_period_org_idx").on(table.organizationId),
  ]
);

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(organizationMember),
  invitations: many(organizationInvitation),
  publishedSites: many(publishedSite),
  domains: many(domain),
  projectMetas: many(projectMeta),
}));

export const organizationMemberRelations = relations(
  organizationMember,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationMember.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [organizationMember.userId],
      references: [user.id],
    }),
  }),
);

export const organizationInvitationRelations = relations(
  organizationInvitation,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationInvitation.organizationId],
      references: [organization.id],
    }),
    inviter: one(user, {
      fields: [organizationInvitation.inviterId],
      references: [user.id],
    }),
  }),
);
