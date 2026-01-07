# Client Editor (Multi-Tenant) — Unified Implementation Plan

Enable a multi-tenant mode where multiple websites are hosted in one Vivd instance, with customer "editors" restricted to their assigned site without AI capabilities.

> [!NOTE]
> This plan combines the best elements of Plan A (conservative migration, security fixes) and Plan B (permission architecture, implementation detail).

---

## Role Hierarchy

| Role              | Access Scope       | AI Features | Description                                        |
| ----------------- | ------------------ | ----------- | -------------------------------------------------- |
| **admin**         | All projects       | ✅ Full     | Instance owner. Full access including maintenance  |
| **user**          | All projects       | ✅ Full     | Team members. Full editing, no user management     |
| **client_editor** | Assigned project   | ❌ None     | Customer. Text editing, file uploads, save/publish |

> [!TIP]
> No breaking changes — adds `client_editor` role without renaming existing roles.

### Permission Matrix

| Capability             | admin | user | client_editor |
| ---------------------- | ----- | ---- | ------------- |
| Access all projects    | ✅    | ✅   | ❌            |
| Access assigned project| ✅    | ✅   | ✅            |
| Create/delete projects | ✅    | ✅   | ❌            |
| Edit text (inline)     | ✅    | ✅   | ✅            |
| Upload files/images    | ✅    | ✅   | ✅            |
| Drag & drop editing    | ✅    | ✅   | ✅            |
| Save/snapshot (Git)    | ✅    | ✅   | ✅            |
| Publish/update site    | ✅    | ✅   | ✅ (own site) |
| AI Agent (chat)        | ✅    | ✅   | ❌            |
| Pre-publish checklist  | ✅    | ✅   | ❌            |
| AI image editing       | ✅    | ✅   | ❌            |
| User management        | ✅    | ❌   | ❌            |
| System maintenance     | ✅    | ❌   | ❌            |

---

## Proposed Changes

### Database Schema

#### [NEW] [schema.ts](file:///Users/felixpahlke/code/vivd/backend/src/db/schema.ts) — `project_member` table

Bind `client_editor` users to a project **even before the site is published**:

```typescript
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
```

> [!NOTE]
> v1 constraint: a `client_editor` is assigned to exactly one project (enforced with a unique constraint/index on `project_member.user_id`).

---

### Backend — Permission System

#### [NEW] [PermissionService.ts](file:///Users/felixpahlke/code/vivd/backend/src/services/PermissionService.ts)

```typescript
export type UserRole = "admin" | "user" | "client_editor";

export type Permission =
  | "projects:list:all"
  | "projects:create"
  | "projects:delete"
  | "project:edit:text"
  | "project:edit:files"
  | "project:publish"
  | "project:git"
  | "agent:chat"
  | "agent:checklist"
  | "ai:images"
  | "admin:users"
  | "admin:maintenance";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    /* all permissions */
  ],
  user: [
    /* all except admin:users, admin:maintenance */
  ],
  client_editor: [
    "project:edit:text",
    "project:edit:files",
    "project:git",
    "project:publish",
  ],
};

export class PermissionService {
  hasPermission(role: UserRole, permission: Permission): boolean;

  async canAccessProject(
    userId: string,
    role: UserRole,
    projectSlug: string
  ): Promise<boolean>;
}
```

---

#### [MODIFY] [trpc.ts](file:///Users/felixpahlke/code/vivd/backend/src/trpc.ts)

Add new procedure middlewares and preserve request context:

```diff
+ // (Optional) Preserve request host if you want customer-domain auto-scoping
+ export const protectedProcedure = t.procedure.use(async (opts) => {
+   // ... existing auth check ...
+   return opts.next({
+     ctx: {
+       ...ctx,
+       requestHost: getRequestHost(opts.ctx.req), // normalized host
+     },
+   });
+ });

+ // AI features — admin/user only
+ export const aiProcedure = protectedProcedure.use(async (opts) => {
+   if (opts.ctx.session.user.role === "client_editor") {
+     throw new TRPCError({
+       code: "UNAUTHORIZED",
+       message: "AI features not available for your account",
+     });
+   }
+   return opts.next();
+ });

+ // Project-scoped — validates client_editor access
+ export const projectScopedProcedure = protectedProcedure.use(async (opts) => {
+   // For client_editor: validate the input projectSlug matches assigned project
+   // For admin/user: allow all
+ });
```

Helper function:

```typescript
// backend/src/utils/requestHost.ts
import type { Request } from "express";

export function getRequestHost(req: Request): string {
  const forwarded = req.headers["x-forwarded-host"];
  const hostHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.headers.host ?? "";
  const first = hostHeader.split(",")[0]?.trim() ?? "";
  const withoutPort = first.includes(":") ? first.split(":")[0] : first;
  return withoutPort.toLowerCase();
}
```

---

#### [MODIFY] Router Procedure Changes

| File                     | Function                  | Current              | New                             |
| ------------------------ | ------------------------- | -------------------- | ------------------------------- |
| `agent/sessions.ts`      | `runTask`, `listSessions` | `protectedProcedure` | `aiProcedure`                   |
| `agent/checklist.ts`     | All                       | `protectedProcedure` | `aiProcedure`                   |
| `assets/aiImages.ts`     | All                       | `protectedProcedure` | `aiProcedure`                   |
| `project/publish.ts`     | All                       | `protectedProcedure` | `projectScopedProcedure`        |
| `project/git.ts`         | All                       | `protectedProcedure` | `projectScopedProcedure`        |
| `project/generation.ts`  | `generate`, `regenerate`  | `protectedProcedure` | `adminProcedure`                |
| `project/maintenance.ts` | `delete`                  | `protectedProcedure` | `adminProcedure`                |
| `project/generation.ts`  | `list`                    | `protectedProcedure` | Keep (filter for client_editor) |

---

### Backend — Critical Security Fix

#### [MODIFY] [server.ts](file:///Users/felixpahlke/code/vivd/backend/src/server.ts)

> [!CAUTION]
> Current static file serving allows any authenticated user to access any project by URL. Must fix for multi-tenant security.

Replace the studio static mount with an authenticated handler that validates `client_editor` project access.

> [!NOTE]
> `/vivd-studio/api/preview/*` stays public intentionally (shareable preview link).

```typescript
// BEFORE: Vulnerable to cross-tenant access
app.use("/vivd-studio/api/projects", express.static(projectsDir));

// AFTER: Validate access per request
app.get("/vivd-studio/api/projects/:slug/:version/*", async (req, res) => {
  const { slug, version } = req.params;
  const session = await getSession(req);

  await assertProjectAccess({
    session,
    projectSlug: slug,
  });

  const safePath = safeJoin(projectsDir, slug, version, req.params[0]);
  res.sendFile(safePath);
});
```

---

### Frontend — Permission Hook

#### [NEW] [usePermissions.ts](file:///Users/felixpahlke/code/vivd/frontend/src/hooks/usePermissions.ts)

```typescript
export function usePermissions() {
  const { session } = authClient.useSession();
  const role = session?.user?.role as UserRole;

  return {
    role,
    isAdmin: role === "admin",
    isUser: role === "user",
    isClientEditor: role === "client_editor",

    // Feature gates
    canUseAgent: role !== "client_editor",
    canUseAiImages: role !== "client_editor",
    canPublish: true, // all roles can publish (scoped for client_editor)
    canSave: true, // all roles can save/snapshot
    canManageProjects: role !== "client_editor",
    canManageUsers: role === "admin",
  };
}
```

---

#### [MODIFY] UI Components

| Component            | Change                                                     |
| -------------------- | ---------------------------------------------------------- |
| `PreviewToolbar.tsx` | Hide AI chat, checklist for `client_editor`                |
| `AssetExplorer.tsx`  | Hide AI image actions for `client_editor`                  |
| `Chat/` components   | Conditionally render based on `canUseAgent`                |
| `PublishDialog.tsx`  | Show for all roles (hide AI checklist for `client_editor`) |
| `ProjectsList.tsx`   | Filter to assigned project for `client_editor`             |
| `Admin.tsx`          | Hide user management for non-admin                         |

---

### Auto-Scoping (Option B)

Primary flow: `client_editor` logs in via the instance URL (no domain mapping required), then the UI auto-opens their assigned project.

Optional: if the customer domain points to the same instance, `customer.com/vivd-studio` can behave the same (still project-scoped via membership). If you want an extra safety check, you can additionally assert that `requestHost` maps (via `published_site.domain`) to the same `projectSlug`.

For `admin`/`user` roles: no scoping, full access as today.

---

## Admin Workflow (v1)

Simple flow via existing admin panel:

1. Admin creates user with role = `client_editor`
2. Admin assigns user to a project (creates `project_member` row)
3. Admin shares login URL (recommended): `https://<your-instance-domain>/vivd-studio`

---

## Open Decisions

| Decision             | Options                                            |
| -------------------- | -------------------------------------------------- |
| **Future AI access** | Per-site metering if AI images enabled for editors |

---

## Verification Plan

### Automated Tests

- Permission service unit tests (all role/permission combos)
- API authorization tests (editor cannot call agent routes, cannot access other projects)
- Static file access tests (editor cannot URL-hack to other projects)

### Manual Verification

1. **Editor flow**: Create editor → assign to project → verify text edit works → verify AI hidden
2. **Cross-tenant test**: Editor tries to access `/vivd-studio/api/projects/OTHER-SLUG/...` → 403
3. **Admin flow**: Verify full access, user management works

---

## Migration

```sql
-- Add project_member table
CREATE TABLE project_member (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  project_slug TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- v1: exactly one project per client_editor
CREATE UNIQUE INDEX project_member_user_unique ON project_member(user_id);

CREATE INDEX project_member_user_idx ON project_member(user_id);
CREATE INDEX project_member_project_idx ON project_member(project_slug);
```

No changes to existing users or roles required.
