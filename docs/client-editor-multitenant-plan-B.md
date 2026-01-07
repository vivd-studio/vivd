# Multi-Tenant User Roles Implementation Plan

Enable vivd to run as a multi-tenant solution where customers (editors) have access to only their assigned project with restricted AI capabilities, while maintaining full control for super-admins and admins.

## User Review Required

> [!IMPORTANT] > **Role Naming Decision**: I've proposed `superadmin` → `admin` → `editor`. Please confirm this naming works for you, or suggest alternatives.

> [!WARNING] > **Breaking Change**: The existing `admin` role will be renamed to `superadmin`. The first user hook in `auth.ts` will need to assign `superadmin` instead of `admin`. Existing admin users will need a migration.

---

## Role Hierarchy

| Role           | Access Scope             | AI Features | Description                                                                                                 |
| -------------- | ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------- |
| **superadmin** | All projects             | ✅ Full     | You (instance owner). Can do everything including manage users, billing, licensing, **system maintenance**. |
| **admin**      | All projects             | ✅ Full     | Site maintainers/agencies. Full editing but no user management, billing, **or system maintenance**.         |
| **editor**     | Assigned project(s) only | ❌ None     | Website owner/customer. Text editing, file uploads, drag & drop only.                                       |

### Detailed Permission Matrix

| Capability                        | superadmin | admin        | editor                |
| --------------------------------- | ---------- | ------------ | --------------------- |
| **Access all projects**           | ✅         | ✅           | ❌                    |
| **Access assigned project**       | ✅         | ✅           | ✅                    |
| **Create new projects**           | ✅         | ✅           | ❌                    |
| **Delete projects**               | ✅         | ✅           | ❌                    |
| **Edit text (inline)**            | ✅         | ✅           | ✅                    |
| **Upload files/images**           | ✅         | ✅           | ✅                    |
| **Drag & drop editing**           | ✅         | ✅           | ✅                    |
| **Publish website**               | ✅         | ✅           | ❌ (future: optional) |
| **AI Agent (chat)**               | ✅         | ✅           | ❌                    |
| **Pre-publish checklist**         | ✅         | ✅           | ❌                    |
| **"Fix this" prompts**            | ✅         | ✅           | ❌                    |
| **AI image editing**              | ✅         | ✅           | ❌ (future: optional) |
| **AI image generation**           | ✅         | ✅           | ❌ (future: optional) |
| **Version history**               | ✅         | ✅           | ❌ (or view-only?)    |
| **Git save/revert**               | ✅         | ✅           | ❌                    |
| **User management**               | ✅         | ❌           | ❌                    |
| **Admin panel**                   | ✅         | ✅ (limited) | ❌                    |
| **Billing/licensing**             | ✅         | ❌           | ❌                    |
| **System maintenance/migrations** | ✅         | ❌           | ❌                    |

---

## System Maintenance Functions (superadmin only)

The following functions in `project/maintenance.ts` should be restricted to **superadmin only**:

| Function                      | Current          | New                   |
| ----------------------------- | ---------------- | --------------------- |
| `resetStatus`                 | `adminProcedure` | `superadminProcedure` |
| `migrateVivdProcessFiles`     | `adminProcedure` | `superadminProcedure` |
| `migrateProjectTemplateFiles` | `adminProcedure` | `superadminProcedure` |

These are system-wide maintenance operations that could affect all projects and should only be run by the instance owner.

---

## Proposed Changes

### Database Schema

#### [MODIFY] [schema.ts](file:///Users/felixpahlke/code/vivd/backend/src/db/schema.ts)

Add user-project association table:

```typescript
// New table: Associate users with specific projects (for editor role)
export const userProject = pgTable(
  "user_project",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    projectVersion: integer("project_version").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("user_project_user_idx").on(table.userId),
    index("user_project_project_idx").on(
      table.projectSlug,
      table.projectVersion
    ),
  ]
);
```

Also update the role type documentation (although the field is just `text`, we should document the valid values).

---

### Backend - Permission System

#### [NEW] [PermissionService.ts](file:///Users/felixpahlke/code/vivd/backend/src/services/PermissionService.ts)

Create a centralized permission service:

```typescript
export type UserRole = "superadmin" | "admin" | "editor";

export type Permission =
  | "projects:list:all" // View all projects
  | "projects:create" // Create new projects
  | "projects:delete" // Delete projects
  | "project:edit:text" // Inline text editing
  | "project:edit:files" // Upload/manage files
  | "project:publish" // Publish to domain
  | "project:git" // Git save/revert/history
  | "agent:chat" // Use AI agent
  | "agent:checklist" // Run pre-publish checklist
  | "ai:images" // AI image editing/generation
  | "admin:users" // User management
  | "admin:billing" // Billing/licensing
  | "admin:maintenance"; // System maintenance/migrations

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  superadmin: [
    /* all permissions */
  ],
  admin: [
    /* all except admin:users, admin:billing, admin:maintenance */
  ],
  editor: ["project:edit:text", "project:edit:files"],
};

export class PermissionService {
  hasPermission(role: UserRole, permission: Permission): boolean;
  hasAnyPermission(role: UserRole, permissions: Permission[]): boolean;
  async canAccessProject(
    userId: string,
    role: UserRole,
    projectSlug: string,
    version: number
  ): Promise<boolean>;
}
```

---

#### [MODIFY] [trpc.ts](file:///Users/felixpahlke/code/vivd/backend/src/trpc.ts)

Add new middleware procedures:

```diff
+ export const superadminProcedure = protectedProcedure.use(async function isSuperAdmin(opts) {
+   const { ctx } = opts;
+   if (ctx.session.user.role !== "superadmin") {
+     throw new TRPCError({
+       code: "UNAUTHORIZED",
+       message: "Superadmin access required",
+     });
+   }
+   return opts.next();
+ });

  export const adminProcedure = protectedProcedure.use(async function isAdmin(opts) {
      const { ctx } = opts;
-     if (ctx.session.user.role !== "admin") {
+     if (!["superadmin", "admin"].includes(ctx.session.user.role)) {
          throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Admin access required",
          });
      }
      return opts.next();
  });

+ // New: Check if user can use AI features (superadmin + admin only)
+ export const aiProcedure = protectedProcedure.use(async function canUseAI(opts) {
+   const { ctx } = opts;
+   if (!["superadmin", "admin"].includes(ctx.session.user.role)) {
+     throw new TRPCError({
+       code: "UNAUTHORIZED",
+       message: "AI features not available for your account",
+     });
+   }
+   return opts.next();
+ });

+ // New: Check if user can access a specific project
+ export const projectAccessProcedure = protectedProcedure.use(async function canAccessProject(opts) {
+   // Implementation checks role and user_project table
+ });
```

---

#### [MODIFY] [auth.ts](file:///Users/felixpahlke/code/vivd/backend/src/auth.ts)

Update first-user hook:

```diff
  before: async (user) => {
    const existingUser = await db.query.user.findFirst();
-   // first user is admin
+   // first user is superadmin
    if (!existingUser) {
      return {
        data: {
          ...user,
-         role: "admin",
+         role: "superadmin",
        },
      };
    }
```

---

#### [MODIFY] Router files

Apply appropriate procedure types:

| File                                     | Function                      | Current              | New                           |
| ---------------------------------------- | ----------------------------- | -------------------- | ----------------------------- |
| **Agent (AI Features)**                  |
| `agent/sessions.ts`                      | `runTask`                     | `protectedProcedure` | `aiProcedure`                 |
| `agent/sessions.ts`                      | `listSessions` etc.           | `adminProcedure`     | `aiProcedure`                 |
| `agent/checklist.ts`                     | All                           | `protectedProcedure` | `aiProcedure`                 |
| `agent/subscription.ts`                  | All                           | `adminProcedure`     | `aiProcedure`                 |
| `assets/aiImages.ts`                     | All                           | `protectedProcedure` | `aiProcedure`                 |
| **System Maintenance (superadmin only)** |
| `project/maintenance.ts`                 | `resetStatus`                 | `adminProcedure`     | `superadminProcedure`         |
| `project/maintenance.ts`                 | `migrateVivdProcessFiles`     | `adminProcedure`     | `superadminProcedure`         |
| `project/maintenance.ts`                 | `migrateProjectTemplateFiles` | `adminProcedure`     | `superadminProcedure`         |
| **Publishing (admin+)**                  |
| `project/publish.ts`                     | All                           | `protectedProcedure` | `adminProcedure`              |
| **Git Operations (admin+)**              |
| `project/git.ts`                         | All                           | `protectedProcedure` | `adminProcedure`              |
| **Project Management**                   |
| `project/generation.ts`                  | `list`                        | `protectedProcedure` | Keep (but filter for editors) |
| `project/generation.ts`                  | `generate`, `regenerate`      | `protectedProcedure` | `adminProcedure`              |
| `project/maintenance.ts`                 | `delete`                      | `protectedProcedure` | `adminProcedure`              |

---

### Frontend - Permission Context

#### [NEW] [usePermissions.ts](file:///Users/felixpahlke/code/vivd/frontend/src/hooks/usePermissions.ts)

```typescript
export function usePermissions() {
  const { session } = authClient.useSession();
  const role = session?.user?.role as UserRole;

  return {
    role,
    isSuperAdmin: role === "superadmin",
    isAdmin: ["superadmin", "admin"].includes(role),
    isEditor: role === "editor",

    // Feature checks
    canUseAgent: ["superadmin", "admin"].includes(role),
    canUseAiImages: ["superadmin", "admin"].includes(role),
    canRunChecklist: ["superadmin", "admin"].includes(role),
    canPublish: ["superadmin", "admin"].includes(role),
    canManageProjects: ["superadmin", "admin"].includes(role),
    canManageUsers: role === "superadmin",
    canRunMaintenance: role === "superadmin",
  };
}
```

---

#### [MODIFY] UI Components

Hide features based on permissions:

| Component            | Change                                                      |
| -------------------- | ----------------------------------------------------------- |
| `PreviewToolbar.tsx` | Hide AI chat button, checklist, version history for editors |
| `AssetExplorer.tsx`  | Hide "AI Edit" and "Create with AI" for editors             |
| `Chat/` components   | Not rendered for editors                                    |
| `PublishDialog.tsx`  | Not shown for editors (or show read-only status)            |
| `Layout.tsx`         | Hide admin links for editors                                |
| `ProjectsList.tsx`   | Filter to only assigned projects for editors                |
| `Admin.tsx`          | Hide maintenance functions for non-superadmin               |

---

### Domain-Based Access

#### [NEW] [DomainProjectResolver.ts](file:///Users/felixpahlke/code/vivd/backend/src/services/DomainProjectResolver.ts)

When an editor accesses `theirdomain.com/vivd-studio`, automatically scope them to that domain's project:

```typescript
export class DomainProjectResolver {
  async getProjectForDomain(
    domain: string
  ): Promise<{ slug: string; version: number } | null> {
    // Query publishedSite table to find project for this domain
  }

  async validateEditorAccess(userId: string, domain: string): Promise<boolean> {
    // Check if editor is assigned to the project published on this domain
  }
}
```

---

## Database Migration

#### [NEW] Migration: Add user_project table & update roles

```sql
-- Create user_project junction table
CREATE TABLE user_project (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  project_slug TEXT NOT NULL,
  project_version INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX user_project_user_idx ON user_project(user_id);
CREATE INDEX user_project_project_idx ON user_project(project_slug, project_version);

-- Migrate existing admin users to superadmin
UPDATE "user" SET role = 'superadmin' WHERE role = 'admin';
```

---

## Verification Plan

### Automated Tests

1. **Permission Service Unit Tests**

   - Test all role/permission combinations
   - Test project access checks

2. **API Authorization Tests**
   - Test editor cannot call agent routes
   - Test editor cannot access other projects
   - Test admin cannot call maintenance routes
   - Test admin can access all projects
   - Test superadmin has full access

### Manual Verification

1. **Editor Flow**

   - Create editor user assigned to one project
   - Access their project via domain
   - Verify they can edit text, upload files
   - Verify AI features are hidden
   - Verify they cannot see other projects

2. **Admin Flow**

   - Create admin user
   - Verify full project access
   - Verify AI features work
   - Verify cannot access user management
   - Verify cannot run maintenance migrations

3. **Superadmin Flow**
   - Verify complete access
   - Verify user management works
   - Verify maintenance functions work

---

## Future Enhancements

- [ ] **Optional editor permissions**: Per-user flags to enable AI images or publishing
- [ ] **User management UI**: Allow superadmin to create editors via UI
- [ ] **Invitation system**: Email invite flow for new editors
- [ ] **Per-user token tracking**: When editors get AI access, track their usage separately
- [ ] **Domain auto-assignment**: When publishing, auto-create editor accounts for the domain
