# Base: shared system dependencies for all stages
FROM node:23-slim AS base
WORKDIR /app

# Install git + ca-certificates (git clone/push) required by studio tooling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Dev base: extra dependencies needed for connected-mode local studio machines.
# Keep these out of the production backend image (prod stage is FROM base).
FROM base AS devbase

# python3 is required by opencode-ai (used by the studio OpenCode server).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (required for the studio OpenCode server when running STUDIO_MACHINE_PROVIDER=local)
# Clean up unused musl binary (saves ~120MB)
RUN npm install -g opencode-ai@1.4.1 \
  && rm -rf /usr/local/lib/node_modules/opencode-ai/node_modules/*musl* \
  && npm cache clean --force

# Stage 1: Dependencies (workspace-aware)
FROM devbase AS deps

# Install deps for backend (+ shared) and local studio spawning (dev)
COPY package.json package-lock.json ./
COPY packages/installed-plugins/package.json packages/installed-plugins/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/plugin-analytics/package.json packages/plugin-analytics/package.json
COPY packages/plugin-contact-form/package.json packages/plugin-contact-form/package.json
COPY packages/plugin-newsletter/package.json packages/plugin-newsletter/package.json
# Keep workspace metadata available for npm workspaces resolution
COPY packages/cli/package.json packages/cli/package.json
COPY packages/studio/package.json packages/studio/package.json
COPY packages/theme/package.json packages/theme/package.json

COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci -w @vivd/plugin-sdk -w @vivd/shared -w @vivd/installed-plugins -w @vivd/plugin-analytics -w @vivd/plugin-contact-form -w @vivd/plugin-newsletter -w @vivd/backend -w @vivd/cli -w @vivd/studio --include-workspace-root=false \
    && npm cache clean --force

# Stage 2: Development (hot reload)
FROM deps AS dev
COPY packages/installed-plugins ./packages/installed-plugins
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/plugin-analytics ./packages/plugin-analytics
COPY packages/plugin-contact-form ./packages/plugin-contact-form
COPY packages/plugin-newsletter ./packages/plugin-newsletter
COPY packages/cli ./packages/cli
COPY packages/theme ./packages/theme
COPY packages/studio ./packages/studio

# Ensure shared is built (runtime imports come from `@vivd/shared/dist/*`)
RUN npm run build -w @vivd/plugin-sdk
RUN npm run build -w @vivd/shared

WORKDIR /app/packages/backend
COPY packages/backend/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 3: Build (compile TypeScript)
FROM deps AS builder
COPY packages/installed-plugins ./packages/installed-plugins
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/plugin-analytics ./packages/plugin-analytics
COPY packages/plugin-contact-form ./packages/plugin-contact-form
COPY packages/plugin-newsletter ./packages/plugin-newsletter

RUN npm run build -w @vivd/plugin-sdk
RUN npm run build -w @vivd/shared
RUN npm run build -w @vivd/backend

# Template files are needed at runtime for project scaffolding (.gitignore)
RUN mkdir -p /app/packages/backend/dist/templates \
    && cp -R /app/packages/backend/src/generator/templates/* /app/packages/backend/dist/templates/

# Stage 4: Production (minimal runtime image)
FROM base AS prod

ARG VIVD_IMAGE_VERSION=unknown
ARG VIVD_IMAGE_REVISION=unknown
ENV VIVD_IMAGE_VERSION=${VIVD_IMAGE_VERSION}
ENV VIVD_IMAGE_REVISION=${VIVD_IMAGE_REVISION}
LABEL org.opencontainers.image.version=$VIVD_IMAGE_VERSION
LABEL org.opencontainers.image.revision=$VIVD_IMAGE_REVISION

# Install production deps for the backend workspace (links shared as a workspace dep)
COPY package.json package-lock.json ./
COPY packages/installed-plugins/package.json packages/installed-plugins/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/plugin-analytics/package.json packages/plugin-analytics/package.json
COPY packages/plugin-contact-form/package.json packages/plugin-contact-form/package.json
COPY packages/plugin-newsletter/package.json packages/plugin-newsletter/package.json
COPY packages/studio/package.json packages/studio/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci -w @vivd/plugin-sdk -w @vivd/installed-plugins -w @vivd/plugin-analytics -w @vivd/plugin-contact-form -w @vivd/plugin-newsletter -w @vivd/backend --omit=dev --include-workspace-root=false \
    && npm cache clean --force

# Copy built outputs
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/plugin-sdk/dist ./packages/plugin-sdk/dist
COPY --from=builder /app/packages/backend/drizzle ./packages/backend/drizzle
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Needed so the publish service can reload Caddy's configuration
RUN mkdir -p /etc/caddy

# Copy entrypoint script
COPY packages/backend/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /app/packages/backend
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3000
CMD ["npm", "start"]
