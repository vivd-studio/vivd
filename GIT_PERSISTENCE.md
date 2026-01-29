# Git Repository Persistence

## Overview

Git repositories are **fully persistent** across container restarts and deployments. They are stored in Docker named volumes that survive container lifecycle events.

## Storage Architecture

### Repository Location

Git repositories are stored at:
```
/app/projects/{slug}/v{version}/.git
```

The directory structure looks like:
```
/app/projects/
├── my-portfolio/
│   ├── v1/.git/              ← Git repository (persistent)
│   ├── v1/index.html
│   ├── v1/src/
│   ├── v2/.git/              ← Another version (persistent)
│   └── v2/...
└── another-project/
    ├── v1/.git/
    └── v1/...
```

### Volume Configuration

Git repositories are backed by the `backend_data` named Docker volume:

**docker-compose.yml:**
```yaml
backend:
  volumes:
    - backend_data:/app/projects    ← Persistent storage
    - opencode_data:/root/.local/share/opencode/storage
    - published_sites:/srv/published
    - caddy_sites:/etc/caddy/sites.d

volumes:
  backend_data:                     ← Named volume (persistent)
  opencode_data:
  caddy_data:
  caddy_config:
  caddy_sites:
  published_sites:
```

## Persistence Guarantee

### Container Restart
✅ **Git repositories survive** container restart
```bash
# Container restarts (e.g., docker-compose restart backend)
# Git repos in backend_data volume remain intact
```

### Container Removal & Recreation
✅ **Git repositories survive** container deletion and recreation
```bash
# Container is removed and recreated
docker-compose down && docker-compose up
# Git repos are still there (volume persists)
```

### Volume Deletion
⚠️ **Git repositories are lost only** if volume is explicitly deleted
```bash
# This will delete git repos (destructive!)
docker volume rm vivd_backend_data

# This is safe (doesn't delete volumes)
docker-compose down
```

### Complete System Reset
⚠️ **Git repositories persist** even if entire stack is torn down
```bash
# This removes containers but NOT volumes
docker-compose down
# Git repos still exist in volume

# This removes containers AND volumes (destructive!)
docker-compose down -v
```

## Development Environment

In development (docker-compose.override.yml), repositories are stored locally:

```yaml
backend:
  volumes:
    - ./packages/backend/projects:/app/projects  ← Local bind mount
```

This means:
- ✅ Repositories are on your local machine
- ✅ Persistent across container restarts
- ✅ Visible in `./packages/backend/projects/`
- ✅ Easy to inspect and debug

Example:
```bash
ls -la ./packages/backend/projects/my-portfolio/v1/
```

## Production Environment

All production compose files use named volumes:

1. **docker-compose.prod.yml** (standard production)
   ```yaml
   volumes:
     - backend_data:/app/projects
   ```

2. **docker-compose.self-hosted.yml** (self-hosted production)
   ```yaml
   volumes:
     - backend_data:/app/projects
   ```

## How Persistence Works

### Named Volumes

Docker named volumes:
- Stored in `/var/lib/docker/volumes/` on the host
- Survive container lifecycle events
- Can be backed up and restored
- Can be migrated between hosts (with proper procedures)

### Data Durability

Git repositories in the volume:
1. **Survive** container restart
2. **Survive** container recreation (docker-compose restart/down/up)
3. **Survive** host reboots (if Docker daemon restarts properly)
4. **Survive** deployment updates (don't use `docker-compose down -v`)
5. **Lost** only if volume is explicitly deleted

## Backup & Recovery

### Backup Git Repositories

To backup all git repositories:

```bash
# List available volumes
docker volume ls | grep backend_data

# Create a backup
docker run --rm \
  -v vivd_backend_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/git-repos-backup.tar.gz -C /data .

# Verify backup
ls -lh backups/git-repos-backup.tar.gz
```

### Restore Git Repositories

```bash
# Create new volume
docker volume create vivd_backend_data

# Restore from backup
docker run --rm \
  -v vivd_backend_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/git-repos-backup.tar.gz -C /data

# Verify restoration
docker volume inspect vivd_backend_data
```

## Cleanup Configuration

The docker-compose files have been cleaned up to remove obsolete GitHub environment variables:

### Removed Variables

The following GitHub-related variables were removed from all compose files:

```yaml
# Removed (these are no longer needed)
- GITHUB_SYNC_ENABLED=${GITHUB_SYNC_ENABLED:-false}
- GITHUB_SYNC_STRICT=${GITHUB_SYNC_STRICT:-false}
- GITHUB_ORG=${GITHUB_ORG:-}
- GITHUB_TOKEN=${GITHUB_TOKEN:-}
- GITHUB_REPO_PREFIX=${GITHUB_REPO_PREFIX:-}
- GITHUB_REMOTE_NAME=${GITHUB_REMOTE_NAME:-origin}
- GITHUB_REPO_VISIBILITY=${GITHUB_REPO_VISIBILITY:-private}
- GITHUB_API_URL=${GITHUB_API_URL:-https://api.github.com}
- GITHUB_GIT_HOST=${GITHUB_GIT_HOST:-github.com}
```

### Files Updated

1. ✅ `docker-compose.yml` - Removed 9 GitHub vars
2. ✅ `docker-compose.prod.yml` - Removed 9 GitHub vars
3. ✅ `docker-compose.self-hosted.yml` - Removed 9 GitHub vars
4. ✅ `docker-compose.override.yml` - Already clean (uses .env)

## Deployment Best Practices

### ✅ Safe Operations

```bash
# Safe: Updates code without touching volumes
docker-compose down
docker-compose pull
docker-compose up -d
# Result: Git repos survive ✓

# Safe: Restarts containers
docker-compose restart backend
# Result: Git repos survive ✓

# Safe: Updates backend service
docker-compose up -d --no-deps --build backend
# Result: Git repos survive ✓
```

### ⚠️ Destructive Operations

```bash
# DESTRUCTIVE: Removes all volumes including git repos!
docker-compose down -v
# Result: Git repos are DELETED ✗

# DESTRUCTIVE: Directly deletes volume
docker volume rm vivd_backend_data
# Result: Git repos are DELETED ✗

# DESTRUCTIVE: Removes unused volumes (may include yours!)
docker volume prune
# Result: May delete git repos ✗
```

## Monitoring Volume Usage

### Check Volume Size

```bash
# List all volumes with size
docker system df

# Get specific volume info
docker volume inspect vivd_backend_data
```

### Track Repository Growth

```bash
# Check total size of repositories
docker run --rm \
  -v vivd_backend_data:/data \
  alpine du -sh /data

# Check per-project size
docker run --rm \
  -v vivd_backend_data:/data \
  alpine du -sh /data/*/v*
```

## Disk Space Management

### Monitor Available Space

```bash
# Check Docker root directory usage
docker system df

# Check host disk usage
df -h /var/lib/docker/volumes/
```

### Clean Old Backups

Over time, repositories and backups may consume significant space:

```bash
# List backups
ls -lh backups/

# Remove old backups (keep recent ones)
rm backups/git-repos-backup-2026-01-01.tar.gz
```

### Archive Old Project Versions

For long-running systems, consider archiving old project versions:

```bash
# Export old version to archive
tar czf archives/my-portfolio-v1.tar.gz \
  projects/my-portfolio/v1/

# Then safely remove from active volume
# (requires manual cleanup - be careful!)
```

## Troubleshooting

### "Volume not found" Error

If you get a volume not found error after deployment:

```bash
# List available volumes
docker volume ls | grep backend

# If volume is missing, check if it was deleted:
docker volume ls -a

# Restore from backup if available
# See "Restore Git Repositories" section above
```

### Insufficient Disk Space

If disk space is running low:

1. Check volume usage: `docker system df`
2. Backup repositories
3. Remove old project versions (if not needed)
4. Clear Docker build cache: `docker builder prune`
5. Backup and move archived versions to external storage

### Volume Corruption

In rare cases of volume corruption:

1. Stop all containers: `docker-compose stop`
2. Backup corrupted volume if possible
3. Delete corrupted volume: `docker volume rm vivd_backend_data`
4. Create new volume: `docker volume create vivd_backend_data`
5. Restore from backup

## Summary

✅ **Git repositories are fully persistent** through:
- Named Docker volumes (`backend_data`)
- Automatic mounting at `/app/projects`
- Survival of container restart/recreation
- Survived deployment updates

⚠️ **Loss occurs only with**:
- Explicit volume deletion (`docker volume rm`)
- `docker-compose down -v` (removes volumes)
- `docker volume prune` (may remove unused volumes)

✅ **Best practice**:
1. Never use `docker-compose down -v` in production
2. Regular backups of git repositories
3. Monitor disk usage
4. Keep compose files safe (don't delete volumes accidentally)

The self-hosted Git HTTP server persists all repositories reliably through standard Docker volume mechanisms.
