# Client Editor (Multi-Tenant) — Unified Implementation Plan

Enable a multi-tenant mode where multiple websites are hosted in one Vivd instance, with customer "editors" restricted to their assigned site without AI capabilities.

> [!NOTE]
> This plan combines the best elements of Plan A (conservative migration, security fixes) and Plan B (permission architecture, implementation detail).

---

## Status: Implemented (Phase 1 & 2 Complete)

### Implemented Features

- [x] **Role Hierarchy**: `owner`, `admin`, `user`, `client_editor`
- [x] **Database Schema**: `project_member` table added
- [x] **Backend Permissions**:
  - `ownerProcedure` (Admin only)
  - `adminProcedure` (Admin + User, blocks Client Editor)
  - `protectedProcedure` (All authenticated)
- [x] **Restricted Endpoints**: AI agents, checklist, and image generation blocked for client editors
- [x] **Project Assignment**: Admin can assign projects to client editors
- [x] **Frontend Logic**:
  - `usePermissions` hook
  - Auto-redirect client editors to assigned project
  - Hide AI features in UI (Asset Explorer, Chat)
  - Hide "Back to Dashboard" for client editors

### Remaining Tasks (Identified Issues)

- [ ] **Admin UI Refresh**: Admin user list needs to refresh immediately after assigning a project.
- [ ] **Unassigned User Handling**: "New Project" button visible for unassigned client editors (should be hidden/blocked).
- [ ] **Admin Management**: Add UI to delete users and update project assignments.
- [ ] **Static File Security**: Secure static file serving (currently deferred).

---

## Role Hierarchy

| Role              | Access Scope     | AI Features | Description                                        |
| ----------------- | ---------------- | ----------- | -------------------------------------------------- |
| **admin**         | All projects     | ✅ Full     | Instance owner. Full access including maintenance  |
| **user**          | All projects     | ✅ Full     | Team members. Full editing, no user management     |
| **client_editor** | Assigned project | ❌ None     | Customer. Text editing, file uploads, save/publish |

### Permission Matrix

| Capability              | admin | user | client_editor |
| ----------------------- | ----- | ---- | ------------- |
| Access all projects     | ✅    | ✅   | ❌            |
| Access assigned project | ✅    | ✅   | ✅            |
| Create/delete projects  | ✅    | ✅   | ❌            |
| Edit text (inline)      | ✅    | ✅   | ✅            |
| Upload files/images     | ✅    | ✅   | ✅            |
| Drag & drop editing     | ✅    | ✅   | ✅            |
| Save/snapshot (Git)     | ✅    | ✅   | ✅            |
| Publish/update site     | ✅    | ✅   | ✅ (own site) |
| AI Agent (chat)         | ✅    | ✅   | ❌            |
| Pre-publish checklist   | ✅    | ✅   | ❌            |
| AI image editing        | ✅    | ✅   | ❌            |
| User management         | ✅    | ❌   | ❌            |
| System maintenance      | ✅    | ❌   | ❌            |

---

## Implementation Details

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

### Backend — Permission System

#### [NEW] [PermissionService.ts](file:///Users/felixpahlke/code/vivd/backend/src/services/PermissionService.ts)

(Implemented via `adminProcedure` and `ownerProcedure` in `trpc.ts`)

#### [MODIFY] Router Procedure Changes

| File                     | Function                  | Current              | New                        |
| ------------------------ | ------------------------- | -------------------- | -------------------------- |
| `agent/sessions.ts`      | `runTask`, `listSessions` | `protectedProcedure` | `adminProcedure`           |
| `agent/checklist.ts`     | All                       | `protectedProcedure` | `adminProcedure`           |
| `assets/aiImages.ts`     | All                       | `protectedProcedure` | `adminProcedure`           |
| `project/generation.ts`  | `generate`, `regenerate`  | `protectedProcedure` | `adminProcedure`           |
| `project/maintenance.ts` | `delete`                  | `protectedProcedure` | `adminProcedure`           |
| `project/generation.ts`  | `list`                    | `protectedProcedure` | Filtered for client_editor |

### Security Note

> [!CAUTION] > **Deferred:** Current static file serving allows any authenticated user to access any project by URL. Must fix for multi-tenant security in a future phase.

### Frontend — Permission Hook

#### [NEW] [usePermissions.ts](file:///Users/felixpahlke/code/vivd/frontend/src/hooks/usePermissions.ts)

Provides role-based boolean flags (`isClientEditor`, `canUseAiImages`, etc.) to UI components.

#### [MODIFY] UI Components

| Component            | Change                                          |
| -------------------- | ----------------------------------------------- |
| `PreviewToolbar.tsx` | Hide AI chat, checklist for `client_editor`     |
| `AssetExplorer.tsx`  | Hide AI image actions for `client_editor`       |
| `App.tsx`            | Auto-redirect client_editor to assigned project |
| `Admin.tsx`          | Add project assignment UI for new users         |

---

## Admin Workflow (v1)

1. Admin creates user with role = `client_editor`
2. Admin assigns user to a project (UI allows doing this in one step)
3. Admin shares login URL: `https://<your-instance-url>/vivd-studio`
4. Client editor logs in and is immediately redirected to their project.

---

## Future Work

- **Delete Users**: Allow deleting users from Admin panel.
- **Update Assignment**: Allow changing assigned project for existing users.
- **Fix Dashboard**: Fully hide "New Project" UI for unassigned client editors.
