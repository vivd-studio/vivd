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
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
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

export const projectTag = pgTable(
  "project_tag",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    colorId: text("color_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.tag] }),
    index("project_tag_org_idx").on(table.organizationId),
  ],
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

export const studioMachineVisit = pgTable(
  "studio_machine_visit",
  {
    organizationId: text("organization_id").notNull(),
    projectSlug: text("project_slug").notNull(),
    version: integer("version").notNull(),
    lastVisitedAt: timestamp("last_visited_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.projectSlug, table.version],
    }),
    foreignKey({
      columns: [table.organizationId, table.projectSlug, table.version],
      foreignColumns: [
        projectVersion.organizationId,
        projectVersion.projectSlug,
        projectVersion.version,
      ],
    }).onDelete("cascade"),
    index("studio_machine_visit_last_visited_idx").on(table.lastVisitedAt),
    index("studio_machine_visit_org_last_visited_idx").on(
      table.organizationId,
      table.lastVisitedAt,
    ),
  ],
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

export const projectPluginInstance = pgTable(
  "project_plugin_instance",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginId: text("plugin_id").notNull(),
    status: text("status").notNull().default("enabled"),
    configJson: jsonb("config_json").notNull().default({}),
    publicToken: text("public_token").notNull(),
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
    uniqueIndex("project_plugin_instance_org_project_plugin_unique").on(
      table.organizationId,
      table.projectSlug,
      table.pluginId,
    ),
    uniqueIndex("project_plugin_instance_public_token_unique").on(table.publicToken),
    index("project_plugin_instance_org_project_idx").on(
      table.organizationId,
      table.projectSlug,
    ),
  ],
);

export const projectPluginAccessRequest = pgTable(
  "project_plugin_access_request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginId: text("plugin_id").notNull(),
    status: text("status").notNull().default("pending"),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    requesterEmail: text("requester_email").notNull().default(""),
    emailProvider: text("email_provider"),
    emailMessageId: text("email_message_id"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
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
    uniqueIndex("project_plugin_access_request_org_project_plugin_unique").on(
      table.organizationId,
      table.projectSlug,
      table.pluginId,
    ),
    index("project_plugin_access_request_org_project_idx").on(
      table.organizationId,
      table.projectSlug,
    ),
    index("project_plugin_access_request_status_idx").on(table.status),
  ],
);

export const pluginEntitlement = pgTable(
  "plugin_entitlement",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("project"), // 'organization' | 'project'
    projectSlug: text("project_slug").notNull().default(""), // empty for organization-scope
    pluginId: text("plugin_id").notNull(), // currently: 'contact_form' | 'analytics' | 'newsletter' | 'table_booking' | 'google_maps'
    state: text("state").notNull().default("disabled"), // 'disabled' | 'enabled' | 'suspended'
    managedBy: text("managed_by").notNull().default("manual_superadmin"), // 'manual_superadmin' | 'plan' | 'self_serve'
    monthlyEventLimit: integer("monthly_event_limit"),
    hardStop: boolean("hard_stop").notNull().default(true),
    turnstileEnabled: boolean("turnstile_enabled").notNull().default(false),
    turnstileWidgetId: text("turnstile_widget_id"),
    turnstileSiteKey: text("turnstile_site_key"),
    turnstileSecretKey: text("turnstile_secret_key"),
    notes: text("notes").notNull().default(""),
    changedByUserId: text("changed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("plugin_entitlement_org_scope_project_plugin_unique").on(
      table.organizationId,
      table.scope,
      table.projectSlug,
      table.pluginId,
    ),
    index("plugin_entitlement_org_plugin_idx").on(
      table.organizationId,
      table.pluginId,
    ),
    index("plugin_entitlement_plugin_state_idx").on(table.pluginId, table.state),
  ],
);

export const contactFormSubmission = pgTable(
  "contact_form_submission",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    sourceHost: text("source_host"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.projectSlug],
      foreignColumns: [projectMeta.organizationId, projectMeta.slug],
    }).onDelete("cascade"),
    index("contact_form_submission_org_project_created_idx").on(
      table.organizationId,
      table.projectSlug,
      table.createdAt,
    ),
    index("contact_form_submission_plugin_created_idx").on(
      table.pluginInstanceId,
      table.createdAt,
    ),
  ],
);

export const contactFormRecipientVerification = pgTable(
  "contact_form_recipient_verification",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'verified'
    verificationTokenHash: text("verification_token_hash"),
    verificationTokenExpiresAt: timestamp("verification_token_expires_at"),
    lastSentAt: timestamp("last_sent_at"),
    verifiedAt: timestamp("verified_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
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
    uniqueIndex("contact_form_recipient_verification_org_project_email_unique").on(
      table.organizationId,
      table.projectSlug,
      table.email,
    ),
    index("contact_form_recipient_verification_plugin_status_idx").on(
      table.pluginInstanceId,
      table.status,
    ),
    index("contact_form_recipient_verification_token_hash_idx").on(
      table.verificationTokenHash,
    ),
  ],
);

export const analyticsEvent = pgTable(
  "analytics_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // 'pageview' | 'custom'
    path: text("path").notNull(),
    referrerHost: text("referrer_host"),
    sourceHost: text("source_host"),
    visitorIdHash: text("visitor_id_hash"),
    sessionId: text("session_id"),
    deviceType: text("device_type"),
    countryCode: text("country_code"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.projectSlug],
      foreignColumns: [projectMeta.organizationId, projectMeta.slug],
    }).onDelete("cascade"),
    index("analytics_event_org_project_created_idx").on(
      table.organizationId,
      table.projectSlug,
      table.createdAt,
    ),
    index("analytics_event_plugin_created_idx").on(
      table.pluginInstanceId,
      table.createdAt,
    ),
    index("analytics_event_plugin_type_created_idx").on(
      table.pluginInstanceId,
      table.eventType,
      table.createdAt,
    ),
    index("analytics_event_plugin_path_created_idx").on(
      table.pluginInstanceId,
      table.path,
      table.createdAt,
    ),
  ],
);

export const newsletterSubscriber = pgTable(
  "newsletter_subscriber",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    name: text("name"),
    status: text("status").notNull().default("pending"),
    mode: text("mode").notNull().default("newsletter"),
    sourceHost: text("source_host"),
    sourcePath: text("source_path"),
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    lastIpHash: text("last_ip_hash"),
    lastConfirmationSentAt: timestamp("last_confirmation_sent_at"),
    lastSignupAt: timestamp("last_signup_at").defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at"),
    unsubscribedAt: timestamp("unsubscribed_at"),
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
    uniqueIndex("newsletter_subscriber_plugin_email_unique").on(
      table.pluginInstanceId,
      table.emailNormalized,
    ),
    index("newsletter_subscriber_org_project_status_created_idx").on(
      table.organizationId,
      table.projectSlug,
      table.status,
      table.createdAt,
    ),
    index("newsletter_subscriber_plugin_signup_idx").on(
      table.pluginInstanceId,
      table.lastSignupAt,
    ),
    index("newsletter_subscriber_plugin_updated_idx").on(
      table.pluginInstanceId,
      table.updatedAt,
    ),
  ],
);

export const newsletterActionToken = pgTable(
  "newsletter_action_token",
  {
    id: text("id").primaryKey(),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => newsletterSubscriber.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.projectSlug],
      foreignColumns: [projectMeta.organizationId, projectMeta.slug],
    }).onDelete("cascade"),
    index("newsletter_action_token_hash_idx").on(table.tokenHash),
    index("newsletter_action_token_subscriber_kind_idx").on(
      table.subscriberId,
      table.kind,
    ),
  ],
);

export const newsletterCampaign = pgTable(
  "newsletter_campaign",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("newsletter"),
    status: text("status").notNull().default("draft"),
    audience: text("audience").notNull().default("all_confirmed"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    estimatedRecipientCount: integer("estimated_recipient_count")
      .notNull()
      .default(0),
    recipientCount: integer("recipient_count").notNull().default(0),
    testSentAt: timestamp("test_sent_at"),
    queuedAt: timestamp("queued_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    canceledAt: timestamp("canceled_at"),
    lastError: text("last_error"),
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
    index("newsletter_campaign_org_project_status_updated_idx").on(
      table.organizationId,
      table.projectSlug,
      table.status,
      table.updatedAt,
    ),
    index("newsletter_campaign_plugin_updated_idx").on(
      table.pluginInstanceId,
      table.updatedAt,
    ),
  ],
);

export const newsletterCampaignDelivery = pgTable(
  "newsletter_campaign_delivery",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => newsletterCampaign.id, { onDelete: "cascade" }),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => newsletterSubscriber.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    recipientName: text("recipient_name"),
    status: text("status").notNull().default("queued"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    skipReason: text("skip_reason"),
    failureReason: text("failure_reason"),
    sentAt: timestamp("sent_at"),
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
    uniqueIndex("newsletter_campaign_delivery_campaign_subscriber_unique").on(
      table.campaignId,
      table.subscriberId,
    ),
    index("newsletter_campaign_delivery_campaign_status_idx").on(
      table.campaignId,
      table.status,
      table.updatedAt,
    ),
    index("newsletter_campaign_delivery_plugin_status_created_idx").on(
      table.pluginInstanceId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const tableBookingReservation = pgTable(
  "table_booking_reservation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("confirmed"),
    serviceDate: text("service_date").notNull(),
    serviceStartAt: timestamp("service_start_at").notNull(),
    serviceEndAt: timestamp("service_end_at").notNull(),
    partySize: integer("party_size").notNull(),
    guestName: text("guest_name").notNull(),
    guestEmail: text("guest_email").notNull(),
    guestEmailNormalized: text("guest_email_normalized").notNull(),
    guestPhone: text("guest_phone").notNull(),
    notes: text("notes"),
    sourceChannel: text("source_channel").notNull().default("online"),
    sourceHost: text("source_host"),
    sourcePath: text("source_path"),
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    lastIpHash: text("last_ip_hash"),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    confirmedAt: timestamp("confirmed_at"),
    cancelledAt: timestamp("cancelled_at"),
    cancelledBy: text("cancelled_by"),
    completedAt: timestamp("completed_at"),
    noShowAt: timestamp("no_show_at"),
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
    index("table_booking_reservation_org_project_status_service_idx").on(
      table.organizationId,
      table.projectSlug,
      table.status,
      table.serviceStartAt,
    ),
    index("table_booking_reservation_plugin_service_date_idx").on(
      table.pluginInstanceId,
      table.serviceDate,
      table.serviceStartAt,
    ),
    index("table_booking_reservation_plugin_email_created_idx").on(
      table.pluginInstanceId,
      table.guestEmailNormalized,
      table.createdAt,
    ),
    index("table_booking_reservation_plugin_source_service_idx").on(
      table.pluginInstanceId,
      table.sourceChannel,
      table.serviceStartAt,
    ),
  ],
);

export const tableBookingActionToken = pgTable(
  "table_booking_action_token",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => tableBookingReservation.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.projectSlug],
      foreignColumns: [projectMeta.organizationId, projectMeta.slug],
    }).onDelete("cascade"),
    index("table_booking_action_token_hash_idx").on(table.tokenHash),
    uniqueIndex("table_booking_action_token_reservation_kind_unique").on(
      table.reservationId,
      table.kind,
    ),
  ],
);

export const tableBookingCapacityAdjustment = pgTable(
  "table_booking_capacity_adjustment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    pluginInstanceId: text("plugin_instance_id")
      .notNull()
      .references(() => projectPluginInstance.id, { onDelete: "cascade" }),
    serviceDate: text("service_date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    mode: text("mode").notNull(),
    capacityValue: integer("capacity_value"),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
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
    index("table_booking_capacity_adjustment_plugin_date_idx").on(
      table.pluginInstanceId,
      table.serviceDate,
      table.startTime,
    ),
    index("table_booking_capacity_adjustment_org_project_date_idx").on(
      table.organizationId,
      table.projectSlug,
      table.serviceDate,
    ),
  ],
);

export const projectMetaRelations = relations(projectMeta, ({ many }) => ({
  versions: many(projectVersion),
  publishChecklists: many(projectPublishChecklist),
  pluginInstances: many(projectPluginInstance),
  contactFormSubmissions: many(contactFormSubmission),
  contactFormRecipientVerifications: many(contactFormRecipientVerification),
  analyticsEvents: many(analyticsEvent),
  newsletterSubscribers: many(newsletterSubscriber),
  newsletterActionTokens: many(newsletterActionToken),
  newsletterCampaigns: many(newsletterCampaign),
  tableBookingReservations: many(tableBookingReservation),
  tableBookingActionTokens: many(tableBookingActionToken),
  tableBookingCapacityAdjustments: many(tableBookingCapacityAdjustment),
}));

export const projectTagRelations = relations(projectTag, ({ one }) => ({
  organization: one(organization, {
    fields: [projectTag.organizationId],
    references: [organization.id],
  }),
}));

export const projectVersionRelations = relations(
  projectVersion,
  ({ one, many }) => ({
    project: one(projectMeta, {
      fields: [projectVersion.organizationId, projectVersion.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    publishChecklists: many(projectPublishChecklist),
    studioMachineVisits: many(studioMachineVisit),
  }),
);

export const studioMachineVisitRelations = relations(
  studioMachineVisit,
  ({ one }) => ({
    projectVersion: one(projectVersion, {
      fields: [
        studioMachineVisit.organizationId,
        studioMachineVisit.projectSlug,
        studioMachineVisit.version,
      ],
      references: [
        projectVersion.organizationId,
        projectVersion.projectSlug,
        projectVersion.version,
      ],
    }),
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

export const projectPluginInstanceRelations = relations(
  projectPluginInstance,
  ({ one, many }) => ({
    project: one(projectMeta, {
      fields: [projectPluginInstance.organizationId, projectPluginInstance.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    contactFormSubmissions: many(contactFormSubmission),
    contactFormRecipientVerifications: many(contactFormRecipientVerification),
    analyticsEvents: many(analyticsEvent),
    newsletterSubscribers: many(newsletterSubscriber),
    newsletterCampaigns: many(newsletterCampaign),
    tableBookingReservations: many(tableBookingReservation),
    tableBookingCapacityAdjustments: many(tableBookingCapacityAdjustment),
  }),
);

export const contactFormSubmissionRelations = relations(
  contactFormSubmission,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [contactFormSubmission.organizationId, contactFormSubmission.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    pluginInstance: one(projectPluginInstance, {
      fields: [contactFormSubmission.pluginInstanceId],
      references: [projectPluginInstance.id],
    }),
  }),
);

export const contactFormRecipientVerificationRelations = relations(
  contactFormRecipientVerification,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [
        contactFormRecipientVerification.organizationId,
        contactFormRecipientVerification.projectSlug,
      ],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    pluginInstance: one(projectPluginInstance, {
      fields: [contactFormRecipientVerification.pluginInstanceId],
      references: [projectPluginInstance.id],
    }),
    createdByUser: one(user, {
      fields: [contactFormRecipientVerification.createdByUserId],
      references: [user.id],
    }),
  }),
);

export const analyticsEventRelations = relations(
  analyticsEvent,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [analyticsEvent.organizationId, analyticsEvent.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    pluginInstance: one(projectPluginInstance, {
      fields: [analyticsEvent.pluginInstanceId],
      references: [projectPluginInstance.id],
    }),
  }),
);

export const newsletterSubscriberRelations = relations(
  newsletterSubscriber,
  ({ one, many }) => ({
    project: one(projectMeta, {
      fields: [newsletterSubscriber.organizationId, newsletterSubscriber.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    pluginInstance: one(projectPluginInstance, {
      fields: [newsletterSubscriber.pluginInstanceId],
      references: [projectPluginInstance.id],
    }),
    actionTokens: many(newsletterActionToken),
  }),
);

export const newsletterActionTokenRelations = relations(
  newsletterActionToken,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [newsletterActionToken.organizationId, newsletterActionToken.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    subscriber: one(newsletterSubscriber, {
      fields: [newsletterActionToken.subscriberId],
      references: [newsletterSubscriber.id],
    }),
  }),
);

export const newsletterCampaignRelations = relations(
  newsletterCampaign,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [newsletterCampaign.organizationId, newsletterCampaign.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    pluginInstance: one(projectPluginInstance, {
      fields: [newsletterCampaign.pluginInstanceId],
      references: [projectPluginInstance.id],
    }),
  }),
);

export const tableBookingReservationRelations = relations(
  tableBookingReservation,
  ({ one, many }) => ({
    project: one(projectMeta, {
      fields: [tableBookingReservation.organizationId, tableBookingReservation.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    pluginInstance: one(projectPluginInstance, {
      fields: [tableBookingReservation.pluginInstanceId],
      references: [projectPluginInstance.id],
    }),
    actionTokens: many(tableBookingActionToken),
  }),
);

export const tableBookingActionTokenRelations = relations(
  tableBookingActionToken,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [tableBookingActionToken.organizationId, tableBookingActionToken.projectSlug],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    reservation: one(tableBookingReservation, {
      fields: [tableBookingActionToken.reservationId],
      references: [tableBookingReservation.id],
    }),
  }),
);

export const tableBookingCapacityAdjustmentRelations = relations(
  tableBookingCapacityAdjustment,
  ({ one }) => ({
    project: one(projectMeta, {
      fields: [
        tableBookingCapacityAdjustment.organizationId,
        tableBookingCapacityAdjustment.projectSlug,
      ],
      references: [projectMeta.organizationId, projectMeta.slug],
    }),
    pluginInstance: one(projectPluginInstance, {
      fields: [tableBookingCapacityAdjustment.pluginInstanceId],
      references: [projectPluginInstance.id],
    }),
  }),
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
  projectTags: many(projectTag),
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
