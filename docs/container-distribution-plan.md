# Container Distribution System

Move from Dokploy server-side builds to pre-built images on GitHub Container Registry (GHCR).

## Architecture

```
GitHub Actions (build & push) → GHCR → Customer docker-compose (pull)
```

## Images

Three public images on `ghcr.io/vivd-studio/`:

- `vivd-server` - Backend (Node.js + OpenCode)
- `vivd-ui` - Frontend (Nginx serving SPA)
- `vivd-caddy` - Caddy with Caddyfile baked in

## Files to Create

### GitHub Actions Workflow

`.github/workflows/publish.yml` - Triggers on version tags (`v*`), builds and pushes all three images with multi-platform support (`linux/amd64`, `linux/arm64`).

### Caddy Dockerfile

`caddy/Dockerfile` - Simple Dockerfile that copies Caddyfile into official Caddy image.

### Customer Template

`docker-compose.customer.yml` - Standalone compose using `image:` instead of `build:`, works with just `docker compose up -d`.

## Update Mechanism

Since Watchtower is deprecated, options:

- **Dokploy webhook** from GitHub Actions (medium effort, high reliability)
- **Cron script** on server: `docker compose pull && up -d` (low effort)
- **Manual** via Dokploy UI

## Verification

1. Push test tag `v0.0.1-test`
2. Verify images appear at `ghcr.io/vivd-studio/`
3. On clean machine: `docker compose -f docker-compose.customer.yml pull`
4. Verify containers start and app is accessible
