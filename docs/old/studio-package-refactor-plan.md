# Plan: Extract Standalone Studio Package

## Overview

Create `@vivd/studio` - a self-contained Express server that provides a complete editing environment for a single project. The studio is a microservice that:

- **Input**: Git repository URL
- **Output**: Commits and pushes changes back to central git server
- **Architecture**: Single Express server with bundled UI, OpenCode, dev server, and editing services
- **Lifecycle**: Starts on-demand when editing is needed, clones repo, serves UI, handles edits, pushes changes

## Architecture

### Package Structure

```
packages/studio/
├── package.json                  # Studio dependencies
├── tsconfig.json
├── server/                       # Express backend
│   ├── index.ts                 # Server entry point
│   ├── config.ts                # Server configuration
│   ├── trpc/                    # TRPC setup
│   │   └── router.ts           # Combined router
│   ├── routers/                 # TRPC routers
│   │   ├── edit.ts             # Editing/patching operations
│   │   ├── preview.ts          # Preview & dev server
│   │   ├── git.ts              # Git operations
│   │   └── assets.ts           # Asset management
│   ├── services/                # Business logic
│   │   ├── GitService.ts       # Git clone/commit/push
│   │   ├── HtmlPatchService.ts # HTML patching
│   │   ├── AstroPatchService.ts # Astro patching
│   │   ├── I18nJsonPatchService.ts # i18n patching
│   │   ├── DevServerService.ts  # Dev server lifecycle
│   │   └── AssetService.ts      # Asset management
│   └── workspace/               # Workspace management
│       └── WorkspaceManager.ts  # Handles repo cloning/cleanup
├── client/                      # React frontend (Vite)
│   ├── src/
│   │   ├── main.tsx            # Entry point
│   │   ├── App.tsx             # Root component
│   │   ├── components/         # UI components
│   │   │   ├── preview/        # Preview & editing UI
│   │   │   ├── toolbar/        # Editor toolbar
│   │   │   └── panels/         # Asset/file panels
│   │   ├── lib/                # Client utilities
│   │   │   ├── trpc.ts        # TRPC client
│   │   │   └── patching.ts    # Patch collection
│   │   └── hooks/              # React hooks
│   ├── index.html
│   ├── vite.config.ts
│   └── tsconfig.json
└── shared/                      # Shared types
    └── types.ts                # Patch types, interfaces
```

### Studio Server Flow

```
1. Main App Request
   ↓
2. Start Studio Server
   - Receives: repo URL, git credentials, port
   - Creates temp workspace directory
   ↓
3. Clone Repository
   - GitService.clone(repoUrl) → workspace/project
   ↓
4. Start Services
   - Dev server (if Astro project)
   - OpenCode server
   - Asset indexing
   ↓
5. Serve UI
   - Express serves bundled client from /dist/client
   - TRPC API at /trpc
   - Dev server proxy at /preview
   ↓
6. User Edits
   - Client calls TRPC mutations (applyPatches)
   - Server applies patches to workspace files
   - Auto-commit on save
   ↓
7. Push Changes
   - GitService.push() → central git server
   ↓
8. Cleanup (on shutdown)
   - Stop dev server
   - Stop OpenCode
   - Delete temp workspace
```

## Critical Files to Move

### From Backend → Studio Server

**Services** (copy to `packages/studio/server/services/`):
- `/packages/backend/src/services/HtmlPatchService.ts`
- `/packages/backend/src/services/AstroPatchService.ts`
- `/packages/backend/src/services/I18nJsonPatchService.ts`
- `/packages/backend/src/devserver/*` → `DevServerService.ts`
- `/packages/backend/src/opencode/*` → `OpencodeService.ts` (if needed)

**TRPC Routers** (adapt to `packages/studio/server/trpcRouters/`):
- `/packages/backend/src/trpcRouters/project/maintenance.ts` → `edit.ts`
  - Keep: `applyHtmlPatches`
  - Remove: admin-only utilities
- `/packages/backend/src/trpcRouters/project/preview.ts` → `preview.ts`
  - Keep: `getPreviewInfo`, `keepAliveDevServer`, `stopDevServer`
- Extract git operations from `/packages/backend/src/trpcRouters/project/git.ts` → `git.ts`
  - Keep: `gitSave`, `gitHasChanges`, `gitHistory`, `gitDiscardChanges`
  - Remove: `gitLoadVersion` (version history not needed in studio)

**Utilities** (copy to `packages/studio/server/services/`):
- `/packages/backend/src/generator/vivdPaths.ts` (adapt for workspace paths)

### From Frontend → Studio Client

**Components** (move to `packages/studio/client/src/components/`):
- `/packages/frontend/src/components/preview/*` → `preview/`
  - PreviewContext.tsx
  - PreviewContent.tsx
  - PreviewIframe.tsx
  - MobileFrame.tsx
  - UnsavedChangesBar.tsx
  - useImageDropZone.ts
  - toolbar/* (all toolbar components)
  - types.ts

**Libraries** (move to `packages/studio/client/src/lib/`):
- `/packages/frontend/src/lib/vivdPreviewTextPatching.ts` → `patching.ts`

**Hooks** (move to `packages/studio/client/src/hooks/`):
- `/packages/frontend/src/hooks/useResizablePanel.ts`

### Asset Explorer Integration

**Decision**: Keep minimal asset management in studio, or integrate full Asset Explorer?

**Option A: Minimal (Recommended)**
- Studio shows basic file tree
- Image drag-and-drop for replacing images
- No upload/delete (manage assets in main app)

**Option B: Full Integration**
- Copy entire `/packages/frontend/src/components/asset-explorer/` to studio
- Requires asset upload, thumbnail generation, management

**Recommendation**: Start with Option A, expand if needed.

### Chat/Agent Integration

**Decision**: Studio should NOT include chat/agent functionality initially.

**Reasoning**:
- Chat is tightly coupled to main app's agent/OpenAI setup
- Studio focuses on manual editing, not AI generation
- Main app can still use chat to generate content, then studio edits it

**Changes needed**:
- Remove chat panel from PreviewContent
- Remove AgentButton from toolbar
- Remove chat-related state from PreviewContext

## New Files to Create

### 1. Server Entry Point

**`packages/studio/server/index.ts`**
```typescript
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router';
import { WorkspaceManager } from './workspace/WorkspaceManager';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3100;
const REPO_URL = process.env.REPO_URL;
const GIT_TOKEN = process.env.GIT_TOKEN;

// Initialize workspace
const workspace = new WorkspaceManager();
await workspace.clone(REPO_URL, GIT_TOKEN);

// TRPC middleware
app.use('/trpc', createExpressMiddleware({
  router: appRouter,
  createContext: () => ({ workspace })
}));

// Serve bundled client
app.use(express.static(path.join(__dirname, '../client')));

// Proxy dev server (if running)
app.use('/preview', workspace.proxyDevServer());

app.listen(PORT, () => {
  console.log(`Studio server running on http://localhost:${PORT}`);
});
```

### 2. Workspace Manager

**`packages/studio/server/workspace/WorkspaceManager.ts`**
```typescript
import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs-extra';
import path from 'path';

export class WorkspaceManager {
  private workspaceDir: string;
  private git: SimpleGit;

  async clone(repoUrl: string, token?: string) {
    this.workspaceDir = path.join('/tmp/studio', Date.now().toString());
    await fs.ensureDir(this.workspaceDir);

    const authUrl = token
      ? repoUrl.replace('://', `://${token}@`)
      : repoUrl;

    this.git = simpleGit();
    await this.git.clone(authUrl, this.workspaceDir);
    this.git = simpleGit(this.workspaceDir);
  }

  async commit(message: string) {
    await this.git.add('.');
    await this.git.commit(message);
  }

  async push() {
    await this.git.push('origin', 'main');
  }

  async hasChanges(): Promise<boolean> {
    const status = await this.git.status();
    return !status.isClean();
  }

  getProjectPath(): string {
    return this.workspaceDir;
  }

  async cleanup() {
    await fs.remove(this.workspaceDir);
  }
}
```

### 3. Git Service

**`packages/studio/server/services/GitService.ts`**
- Wraps WorkspaceManager with high-level operations
- Handles auto-commit on save
- Manages commit history

### 4. Studio Client App

**`packages/studio/client/src/App.tsx`**
```typescript
import { PreviewProvider } from './components/preview/PreviewContext';
import { PreviewContent } from './components/preview/PreviewContent';
import { trpc } from './lib/trpc';

export function App() {
  const { data: previewInfo } = trpc.preview.getInfo.useQuery();

  return (
    <PreviewProvider url={previewInfo?.url}>
      <PreviewContent />
    </PreviewProvider>
  );
}
```

### 5. Studio TRPC Client

**`packages/studio/client/src/lib/trpc.ts`**
```typescript
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../server/trpc/router';

export const trpc = createTRPCReact<AppRouter>();
```

## Integration with Main App

### Starting Studio

**`packages/backend/src/services/StudioService.ts`** (new file in main backend)
```typescript
import { spawn, ChildProcess } from 'child_process';

export class StudioService {
  private processes = new Map<string, ChildProcess>();

  async start(projectSlug: string, repoUrl: string): Promise<number> {
    const port = this.findAvailablePort();

    const process = spawn('node', ['../studio/dist/server.js'], {
      env: {
        PORT: port.toString(),
        REPO_URL: repoUrl,
        GIT_TOKEN: process.env.GIT_SERVER_TOKEN
      }
    });

    this.processes.set(projectSlug, process);
    return port;
  }

  async stop(projectSlug: string) {
    const process = this.processes.get(projectSlug);
    if (process) {
      process.kill();
      this.processes.delete(projectSlug);
    }
  }

  getStudioUrl(projectSlug: string): string | null {
    // Return studio URL if running
  }
}
```

### Main App TRPC Procedure

**Add to `/packages/backend/src/trpcRouters/project.ts`**:
```typescript
getStudioUrl: projectMemberProcedure
  .input(z.object({ slug: z.string(), version: z.number() }))
  .query(async ({ input }) => {
    const repoUrl = await gitServer.getRepoUrl(input.slug, input.version);
    const port = await studioService.start(input.slug, repoUrl);
    return { url: `http://localhost:${port}` };
  })
```

### Embedding Studio UI

**In `/packages/frontend/src/pages/EmbeddedStudio.tsx`**:
```typescript
const { data: studioUrl } = trpc.project.getStudioUrl.useQuery({
  slug,
  version
});

return (
  <iframe
    src={studioUrl}
    className="w-full h-full"
  />
);
```

## Git Server Integration

The studio needs to communicate with the central git server that was recently added (commit e87ac33).

### Git Server Setup

**Location**: `/packages/backend/src/git-server/` (from recent commit)

**Studio needs**:
1. **Clone URL**: Git HTTP(S) URL with authentication
2. **Push access**: Token or credentials for pushing changes
3. **Branch**: Which branch to work on (default: main)

### Git Authentication Flow

```
1. User requests to edit project
   ↓
2. Main backend generates temporary git credentials
   - Creates short-lived token for this session
   ↓
3. Main backend starts studio with:
   - REPO_URL: http://localhost:3000/git/{project}.git
   - GIT_TOKEN: temporary token
   ↓
4. Studio clones using authenticated URL
   ↓
5. User makes edits
   ↓
6. Studio commits and pushes to git server
   - Uses token for authentication
   ↓
7. Git server receives push
   - Updates repository
   - Triggers any webhooks if needed
```

## Dependencies

### Studio Package Dependencies

**Server**:
- express
- @trpc/server
- simple-git (for git operations)
- fs-extra
- parse5 (for HTML parsing)
- @astrojs/compiler (for Astro patching)
- better-auth (optional, if needed)

**Client**:
- react, react-dom
- @trpc/client, @trpc/react-query
- @tanstack/react-query
- vite (build tool)
- tailwindcss
- radix-ui components (copy from @vivd/theme)
- lucide-react (icons)

**Shared**:
- zod (validation)
- typescript

## Build Process

### Studio Package Scripts

**`packages/studio/package.json`**:
```json
{
  "scripts": {
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build:server": "tsc -p server/tsconfig.json",
    "build:client": "vite build",
    "build": "npm run build:server && npm run build:client",
    "start": "node dist/server.js"
  }
}
```

### Build Output

```
packages/studio/dist/
├── server.js              # Compiled server
├── server.js.map
└── client/                # Bundled UI
    ├── index.html
    ├── assets/
    │   ├── index-abc123.js
    │   └── index-abc123.css
    └── ...
```

## Removed Dependencies in Main App

After extracting studio:

**Frontend** can remove/simplify:
- `components/preview/*` (moved to studio)
- `lib/vivdPreviewTextPatching.ts` (moved to studio)
- Some TRPC calls (now proxied to studio)

**Backend** can remove:
- Direct editing procedures (delegated to studio)
- Dev server management (studio handles it)
- Patch services still needed for generation, so KEEP for now

## Implementation Steps

### Phase 1: Setup Studio Package (1-2 commits)

1. Create package structure
   ```bash
   mkdir -p packages/studio/{server,client,shared}
   ```

2. Create `packages/studio/package.json`
   - Add dependencies
   - Add build scripts

3. Create `packages/studio/tsconfig.json` and build configs

4. Create basic server entry point (`server/index.ts`)

5. Create basic client entry point (`client/src/main.tsx`)

6. Update root `package.json` workspaces to include studio

### Phase 2: Move Backend Services (2-3 commits)

1. Copy patch services to `packages/studio/server/services/`
   - HtmlPatchService.ts
   - AstroPatchService.ts
   - I18nJsonPatchService.ts

2. Create WorkspaceManager.ts for git operations

3. Create GitService.ts for high-level git operations

4. Create DevServerService.ts (adapt from backend devserver)

5. Create AssetService.ts for basic file operations

6. Create TRPC routers in `packages/studio/server/trpcRouters/`
   - edit.ts (applyPatches)
   - preview.ts (dev server)
   - git.ts (commit, push, status)
   - assets.ts (list files)

7. Create combined router in `server/trpc/router.ts`

8. Wire up Express server with TRPC middleware

### Phase 3: Move Frontend Components (2-3 commits)

1. Copy preview components to `packages/studio/client/src/components/`
   - All files from `/packages/frontend/src/components/preview/`

2. Copy utilities to `packages/studio/client/src/lib/`
   - vivdPreviewTextPatching.ts

3. Copy hooks to `packages/studio/client/src/hooks/`
   - useResizablePanel.ts

4. Create TRPC client setup (`client/src/lib/trpc.ts`)

5. Create App.tsx that renders PreviewProvider + PreviewContent

6. Create main.tsx entry point

7. Setup Vite build configuration

### Phase 4: Refactor Components (2-3 commits)

1. Simplify PreviewContext
   - Remove: Chat integration, publishing, versioning UI
   - Keep: Edit mode, dev server, git save/push
   - Remove dependencies on main app (auth, routes, etc.)

2. Simplify PreviewContent
   - Remove: Chat panel, asset explorer (full version)
   - Keep: Preview iframe, toolbar, basic file panel
   - Make layout simpler

3. Simplify Toolbar
   - Remove: Publishing, version history, user menu
   - Keep: Edit toggle, save/discard, refresh
   - Remove navigation/routing

4. Update imports to use studio's TRPC client

5. Remove unused dependencies

### Phase 5: Main App Integration (1-2 commits)

1. Create StudioService in main backend
   - Spawn studio server process
   - Manage lifecycle (start/stop)
   - Track running studios by project

2. Add TRPC procedure `project.getStudioUrl`
   - Starts studio if not running
   - Returns studio URL

3. Update EmbeddedStudio.tsx in frontend
   - Call getStudioUrl instead of direct preview
   - Embed studio in iframe

4. Add cleanup on server shutdown
   - Stop all running studio processes

### Phase 6: Git Server Integration (1 commit)

1. Update git server to accept pushes from studio

2. Generate temporary git credentials in main backend

3. Pass credentials to studio on startup

4. Test clone → edit → commit → push flow

### Phase 7: Testing & Polish (1-2 commits)

1. Test full workflow:
   - Start main app
   - Open project for editing
   - Studio starts and clones repo
   - Make edits in studio UI
   - Save changes
   - Verify git commit
   - Verify push to git server
   - Stop studio

2. Add error handling:
   - Git clone failures
   - Git push failures
   - Dev server startup errors
   - Workspace cleanup on errors

3. Add logging for debugging

4. Document studio API and integration

## Verification

### End-to-End Test

1. Start main Vivd app: `npm run dev`

2. Navigate to a project and click "Edit"

3. Verify studio server starts:
   ```bash
   # Should see studio process
   ps aux | grep "studio/dist/server.js"
   ```

4. Verify UI loads in iframe showing project preview

5. Toggle edit mode and modify text

6. Click "Save"

7. Verify git commit created:
   ```bash
   # Check studio workspace
   cd /tmp/studio/{timestamp}/
   git log -1
   ```

8. Verify changes pushed to git server:
   ```bash
   # Check git server repo
   cd projects/{slug}/.git
   git log -1
   ```

9. Close editing view

10. Verify studio process stops and workspace cleaned up

### Unit Tests

- WorkspaceManager.clone()
- GitService.commit() and push()
- HtmlPatchService.applyPatches()
- Studio server startup/shutdown

## Timeline Estimate

- **Phase 1**: Setup - 2 hours
- **Phase 2**: Backend services - 4 hours
- **Phase 3**: Frontend components - 4 hours
- **Phase 4**: Refactoring - 6 hours
- **Phase 5**: Integration - 3 hours
- **Phase 6**: Git server - 2 hours
- **Phase 7**: Testing - 3 hours

**Total**: ~24 hours of work

## Risks & Mitigations

**Risk**: Studio process management complexity
- **Mitigation**: Use PM2 or similar process manager for production

**Risk**: Workspace cleanup failures leaving temp directories
- **Mitigation**: Add cleanup cron job, implement proper error handling

**Risk**: Concurrent edits to same project
- **Mitigation**: Lock mechanism in StudioService (one studio per project)

**Risk**: Studio server crashes
- **Mitigation**: Auto-restart, save workspace state, proper error boundaries

**Risk**: Large repositories slow clone time
- **Mitigation**: Shallow clone, progress feedback to user

## Success Criteria

✅ Studio runs as standalone Express server
✅ Takes git repo URL as input
✅ Clones repo on startup
✅ Serves bundled UI
✅ Provides full editing functionality
✅ Commits changes on save
✅ Pushes to central git server
✅ Integrates with main app via iframe
✅ Cleans up workspace on shutdown
✅ No dependencies on main app internals
