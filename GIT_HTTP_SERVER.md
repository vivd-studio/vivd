# Self-Hosted Git HTTP Server

This document describes the self-hosted Git HTTP server implementation that replaces GitHub sync functionality.

## Overview

The Git HTTP server implements the Git smart HTTP protocol, allowing users to push, pull, fetch, and clone project repositories using standard Git clients with HTTP Basic Auth.

## URL Structure

```
https://<domain>/vivd-studio/api/git/{slug}/v{version}
```

Example:
```bash
git clone https://<domain>/vivd-studio/api/git/my-project/v1
```

## Authentication

The server uses HTTP Basic Auth with session tokens:

```
Authorization: Basic base64(username:token)
```

- **username**: Can be any string (e.g., `git`, `user`, or your user email)
- **token**: The session token from the database

### Getting a Session Token

Session tokens are created when users authenticate through the application. To obtain a session token programmatically:

1. Authenticate via `/vivd-studio/api/auth/*` endpoints (using better-auth)
2. Extract the session token from the auth response
3. Use it with Git operations

### Example with Git Credential Helper

Store credentials in `~/.git-credentials`:

```
https://git:<token>@<domain>/vivd-studio/api/git/my-project/v1
```

Configure Git:
```bash
git config credential.helper store
git clone https://<domain>/vivd-studio/api/git/my-project/v1
# When prompted, enter any username and your session token as the password
```

## Git Operations

### Clone a Repository

```bash
git clone https://<username>:<token>@<domain>/vivd-studio/api/git/<slug>/v<version>
cd <slug>
```

### Push Changes

```bash
git add .
git commit -m "Your commit message"
git push origin main
```

For Astro projects, pushing will automatically trigger a build.

### Pull Changes

```bash
git pull origin main
```

### Fetch Updates

```bash
git fetch origin
```

## Implementation Details

### Services

#### GitHttpService (`services/GitHttpService.ts`)

Implements the Git smart HTTP protocol by spawning `git-upload-pack` and `git-receive-pack` processes:

- `handleInfoRefs()`: Returns available refs (branches, tags)
- `handleUploadPack()`: Handles clone/fetch/pull operations
- `handleReceivePack()`: Handles push operations with optional post-push hooks

**Key Features:**
- Binary stream handling using `execa` with `encoding: null`
- Packet-line format generation for Git protocol
- Post-push hooks that fire asynchronously (non-blocking)

### Middleware

#### Git Auth Middleware (`routes/gitAuth.ts`)

Authentication and authorization for Git endpoints:

1. Extracts HTTP Basic Auth header
2. Validates session token in database
3. Checks session expiration
4. Verifies project member permissions
5. Attaches auth info to request

### Routes

#### Git HTTP Router (`routers/gitHttp.ts`)

Three endpoints implementing the Git smart HTTP protocol:

**Discovery Endpoint:**
```
GET /vivd-studio/api/git/:slug/v:version/info/refs?service=git-upload-pack
```

Returns available refs for the repository in Git packet-line format.

**Upload Pack (Clone/Fetch/Pull):**
```
POST /vivd-studio/api/git/:slug/v:version/git-upload-pack
```

Handles fetch and clone operations.

**Receive Pack (Push):**
```
POST /vivd-studio/api/git/:slug/v:version/git-receive-pack
```

Handles push operations. For Astro projects, automatically triggers a build after successful push.

## Build Trigger

After a successful push, the server:

1. Gets the new commit hash
2. Detects the project type
3. If Astro: Triggers `buildService.triggerBuild()`
4. Returns success to git client immediately (non-blocking)

Build failures don't affect the push operation success.

## Security Considerations

### Authentication

- Session tokens must be cryptographically random (handled by better-auth)
- Tokens have expiration dates (checked before git operations)
- Expired tokens result in 401 Unauthorized

### Authorization

- Users can only access projects they're members of
- Project membership is verified on every git operation
- No cross-project access is possible

### Rate Limiting

Currently, the implementation relies on:
- Database session validation
- Project membership checks

For production deployments, consider adding:
- Rate limiting per token/IP
- Failed auth attempt tracking
- Temporary lockout after N failures

### Data Protection

- Session tokens are extracted from auth headers (not logged)
- Git operations use binary streams (no sensitive data in logs)
- Repository data is isolated per project

## Testing

### Manual Testing

1. Create a project and get a session token
2. Clone the repository:
   ```bash
   git clone https://git:<token>@localhost:3000/vivd-studio/api/git/test-project/v1
   cd test-project
   ```
3. Make changes and commit:
   ```bash
   echo "test" > test.txt
   git add test.txt
   git commit -m "Test commit"
   ```
4. Push changes:
   ```bash
   git push origin main
   ```
5. Verify the commit appears in the project history

### Authentication Testing

Test with invalid token:
```bash
git clone https://git:invalid-token@localhost:3000/vivd-studio/api/git/test/v1
# Should fail with 401 Unauthorized
```

### Build Trigger Testing (Astro Projects)

1. Push to an Astro project
2. Check logs for: `[GitHttp] Triggering build for...`
3. Verify build status: Check `BuildService.getBuildStatus()`
4. Verify build output: Check `dist/` directory

## Troubleshooting

### 401 Unauthorized

- Token is invalid: Verify session token is correct
- Token expired: Get a new session token
- User not a project member: Add user to project members

### 403 Forbidden

- User has no access to this project
- Verify project membership in `projectMember` table

### Clone/Push Fails

Check that:
1. Repository exists at the specified path
2. Git is properly initialized in the version directory
3. User has project member permissions
4. Session token hasn't expired

### Build Not Triggered (Astro Projects)

- Check server logs for `[GitHttp] Triggering build...` messages
- Verify `detectProjectType()` correctly identifies project as Astro
- Check `BuildService` logs for build errors

## Performance Considerations

### Binary Stream Handling

- Uses `encoding: null` for binary data handling
- Supports large repositories and binary files
- Streams are piped directly (no buffering in memory)

### Concurrent Operations

- Multiple simultaneous clones: No issues (read-only)
- Concurrent pushes to same repo: Git handles via `index.lock`
- Concurrent pushes to different repos: Fully concurrent

### Build Triggers

- Fire-and-forget hooks (non-blocking)
- Build failures don't affect git push success
- Multiple pushes trigger independent builds

## Future Enhancements

1. **Atomic Hooks**: Ensure post-push hooks complete before returning to client
2. **Hook Failures**: Track failed hooks and expose in API
3. **Custom Hooks**: Allow per-project post-push hooks
4. **Depth Optimization**: Shallow clones with `--depth` parameter
5. **SSH Support**: Add SSH protocol support alongside HTTP
6. **Webhook Events**: POST events to external URLs on push
7. **Hook Chains**: Sequential post-push hook execution

## Related Files

- Git service: `services/GitService.ts`
- Build service: `services/BuildService.ts`
- Project type detection: `devserver/projectType.ts`
- Database schema: `db/schema.ts`

## References

- Git HTTP Protocol: https://git-scm.com/book/en/v2/Git-Internals-The-Refspec
- Git Smart HTTP: https://github.com/git/git/blob/master/Documentation/technical/http-protocol.txt
- Better Auth: https://better-auth.js.org/
