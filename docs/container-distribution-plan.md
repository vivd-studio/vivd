# Container Distribution System

Move from Dokploy server-side builds to pre-built images on GitHub Container Registry (GHCR).

## Architecture

```
GitHub Actions (build & push) → GHCR → docker-compose.prod.yml (pull)
```

## Images

Three images on `ghcr.io/<github-owner>/`:

- `vivd-server` - Backend (Node.js + OpenCode)
- `vivd-ui` - Frontend (Nginx serving SPA)
- `vivd-caddy` - Caddy with Caddyfile baked in

> **Note**: Images are published to `ghcr.io/vivd-studio/`. The workflow uses `github.repository_owner`, so ensure the repo is under the `vivd-studio` org.

## Files Created ✅

### GitHub Actions Workflow

[`.github/workflows/publish.yml`](file://../.github/workflows/publish.yml) - Triggers on version tags (`v*`) or manual dispatch. Builds and pushes all three images with multi-platform support (`linux/amd64`, `linux/arm64`).

### Caddy Dockerfile

[`caddy/Dockerfile`](file://../caddy/Dockerfile) - Simple Dockerfile that copies Caddyfile into official Caddy image.

### Production Compose

[`docker-compose.prod.yml`](file://../docker-compose.prod.yml) - Standalone compose using `image:` instead of `build:`. Works for both your deployment and customers.

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
