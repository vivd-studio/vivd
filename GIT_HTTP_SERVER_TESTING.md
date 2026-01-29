# Git HTTP Server Testing Guide

This guide provides step-by-step instructions for testing the self-hosted Git HTTP server implementation.

## Prerequisites

1. Vivd backend running locally (default: `http://localhost:3000`)
2. A test project created in the system
3. Git client installed
4. A valid session token from the authentication system

## Getting a Session Token

### Via API Call (Manual)

1. Authenticate via the auth endpoints (using better-auth)
2. Extract the session token from the response
3. Use for Git operations

### Quick Test Setup

For local testing, you can:
1. Start the backend: `npm run dev --workspace=@vivd/backend`
2. Authenticate through the web UI or API
3. Extract the session token from browser dev tools (Network tab, look for auth responses)

## Testing Scenarios

### Scenario 1: Clone Repository

```bash
# Setup
PROJECT_SLUG="my-project"
VERSION=1
TOKEN="your-session-token"
DOMAIN="localhost:3000"

# Clone
git clone https://git:${TOKEN}@${DOMAIN}/vivd-studio/api/git/${PROJECT_SLUG}/v${VERSION}
cd ${PROJECT_SLUG}

# Verify
git log --oneline
```

**Expected Output:**
- Repository cloned successfully
- `.git` directory created
- Remote origin set to the git HTTP URL
- Commit history visible

### Scenario 2: Push Changes

```bash
# Create a change
echo "# Test File" > README.md
git add README.md
git commit -m "Add test README"

# Push
git push origin main

# Verify
git log --oneline
```

**Expected Output:**
- Commit pushed successfully
- Remote main updated
- No errors in push output

### Scenario 3: Build Trigger (Astro Projects)

For projects with Astro framework:

```bash
# Create a change
echo "export const greeting = 'Hello from Git HTTP!'" > src/greeting.ts

# Commit and push
git add src/greeting.ts
git commit -m "Update greeting"
git push origin main
```

**Expected Behavior:**
- Push completes successfully
- Server logs show: `[GitHttp] Triggering build for my-project/v1 after push`
- Build service starts building the project
- Once build completes, `dist/` directory is populated

**Verify Build:**
```bash
# Check build status
curl -s http://localhost:3000/vivd-studio/api/health
# Check if dist/ exists in project directory
ls -la ./projects/my-project/v1/dist/
```

### Scenario 4: Pull Changes

```bash
# Create change from another client
# (In a separate terminal/clone)

# Pull in original clone
git pull origin main

# Verify
git log --oneline
```

**Expected Output:**
- New commits visible in log
- Working directory updated with new files

### Scenario 5: Fetch Updates

```bash
# Fetch without merging
git fetch origin

# Check what's new
git log --oneline origin/main
git diff main origin/main
```

**Expected Output:**
- Remote refs updated
- Can see commits that haven't been merged locally

### Scenario 6: Authentication Failures

```bash
# Try with invalid token
git clone https://git:invalid-token@localhost:3000/vivd-studio/api/git/my-project/v1
# Expected: 401 Unauthorized

# Try with expired token
# (Create a new user account, get expired session token)
git clone https://git:expired-token@localhost:3000/vivd-studio/api/git/my-project/v1
# Expected: 401 Unauthorized

# Try accessing other user's project
git clone https://git:${TOKEN}@localhost:3000/vivd-studio/api/git/other-user-project/v1
# Expected: 403 Forbidden
```

## Advanced Testing

### Testing Binary Files

```bash
# Add a binary file
cp /path/to/image.png ./
git add image.png
git commit -m "Add binary image"
git push origin main

# Verify binary integrity
file ./image.png
```

**Expected:**
- Binary file transmitted correctly
- File type detection works
- No corruption

### Testing Large Files

```bash
# Create a large file (100MB)
dd if=/dev/zero of=large-file.bin bs=1M count=100
git add large-file.bin
git commit -m "Add large file"
git push origin main
```

**Expected:**
- Large push completes (may take time)
- File size preserved
- Git server handles efficiently

### Testing Concurrent Operations

**Terminal 1: Initial Clone**
```bash
git clone https://git:${TOKEN}@${DOMAIN}/vivd-studio/api/git/test-project/v1
cd test-project
```

**Terminal 2: Concurrent Clone**
```bash
git clone https://git:${TOKEN}@${DOMAIN}/vivd-studio/api/git/test-project/v1 test-project-2
```

**Terminal 1: Push**
```bash
echo "from terminal 1" > file1.txt
git add file1.txt
git commit -m "From terminal 1"
git push origin main
```

**Terminal 2: Pull**
```bash
git pull origin main
cat file1.txt  # Should see changes from terminal 1
```

**Expected:**
- Both clones succeed simultaneously
- Push/pull work correctly
- No conflicts or race conditions

## Testing Protocol Details

### Testing info/refs Endpoint

```bash
# Get refs advertisement
curl -v \
  -H "Authorization: Basic $(echo -n 'git:${TOKEN}' | base64)" \
  'http://localhost:3000/vivd-studio/api/git/test-project/v1/info/refs?service=git-upload-pack'

# Should return git packet-line format
```

### Testing git-upload-pack Endpoint

```bash
# This is called automatically by git fetch/clone
# You can test with raw git:

GIT_TRACE=1 git fetch origin main
# Should see detailed trace of upload-pack calls
```

### Testing git-receive-pack Endpoint

```bash
# This is called automatically by git push
# You can test with raw git:

GIT_TRACE=1 git push origin main
# Should see detailed trace of receive-pack calls
```

## Debugging

### Enable Debug Logging

```bash
# Set environment variables
export DEBUG=*
export GIT_TRACE=1
export GIT_TRACE_PERFORMANCE=1

# Run git operation
git clone https://git:${TOKEN}@localhost:3000/vivd-studio/api/git/test/v1
```

### Check Server Logs

```bash
# View backend logs for git operations
tail -f logs/backend.log | grep -i "githttp\|git\|build"
```

### Inspect Git Protocol

```bash
# Use tcpdump to see raw HTTP traffic
sudo tcpdump -i lo -A 'tcp port 3000 and (GET or POST)'

# Or use Wireshark with filter:
# http.host == "localhost:3000" && http.request.uri contains "/git/"
```

## Verification Checklist

After implementation, verify:

- [ ] Clone works with valid token
- [ ] Clone fails with invalid token (401)
- [ ] Clone fails for non-member (403)
- [ ] Push creates commits
- [ ] Push triggers build for Astro projects
- [ ] Pull fetches remote changes
- [ ] Fetch updates remote refs
- [ ] Binary files preserved correctly
- [ ] Large files handled efficiently
- [ ] Concurrent operations work
- [ ] Session expiration enforced
- [ ] Project membership enforced
- [ ] Build logs show hook execution
- [ ] Git protocol compliance (packet-line format)

## Performance Benchmarks

### Baseline Expectations

| Operation | Size | Expected Time |
|-----------|------|---------------|
| Clone (empty repo) | 0 KB | <100ms |
| Clone (100 commits) | ~1 MB | 500ms - 2s |
| Clone (1000 commits) | ~10 MB | 5s - 15s |
| Push (single commit) | 1 KB | <100ms |
| Push (large binary) | 100 MB | 10s - 30s |
| Pull (no changes) | N/A | <100ms |
| Pull (10 new commits) | ~100 KB | 200ms - 500ms |

### Monitoring

Monitor during tests:
- CPU usage
- Memory usage
- Disk I/O
- Network throughput
- Database connections

## Test Commands Summary

```bash
# All-in-one test script
#!/bin/bash

TOKEN="your-session-token"
DOMAIN="localhost:3000"
SLUG="test-project"
VERSION=1

# Clone
echo "=== Testing Clone ==="
git clone https://git:${TOKEN}@${DOMAIN}/vivd-studio/api/git/${SLUG}/v${VERSION} test-clone
cd test-clone

# Make changes
echo "=== Testing Push ==="
echo "Hello from Git HTTP" > test.txt
git add test.txt
git commit -m "Test commit from Git HTTP server"
git push origin main

# Verify
echo "=== Verifying Changes ==="
git log --oneline -n 5

# Pull in another clone
cd ..
echo "=== Testing Pull ==="
git clone https://git:${TOKEN}@${DOMAIN}/vivd-studio/api/git/${SLUG}/v${VERSION} test-clone-2
cd test-clone-2
cat test.txt  # Should contain "Hello from Git HTTP"

echo "=== All tests completed ==="
```

## Troubleshooting Guide

### "Authentication failed"

**Cause:** Invalid token or expired session
**Solution:**
1. Verify token is correct
2. Check token hasn't expired
3. Get new session token from auth system

### "Repository not found"

**Cause:** Project version doesn't exist
**Solution:**
1. Verify project slug and version number
2. Ensure project version directory exists
3. Check project permissions

### "Permission denied"

**Cause:** User not a member of project
**Solution:**
1. Add user to project members
2. Check `projectMember` table in database

### "Receive pack failed"

**Cause:** Problem during push
**Solution:**
1. Check server logs for detailed error
2. Verify git repository is valid
3. Ensure sufficient disk space

### Build Not Triggering

**Cause:** Project not detected as Astro
**Solution:**
1. Check `detectProjectType()` in logs
2. Verify project has `astro.config.js` or `package.json` with astro
3. Check `BuildService` for errors

## Next Steps

After successful testing:

1. Document in production deployment guide
2. Create user-facing documentation
3. Update client SDKs to support git HTTP
4. Monitor git operations in production
5. Set up alerts for auth failures
6. Implement rate limiting if needed
