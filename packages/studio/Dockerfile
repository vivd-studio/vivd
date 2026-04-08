# Base: shared system dependencies for all stages
FROM node:23-slim AS base
WORKDIR /app

# Install git + ca-certs (git clone/push) and python3 (required by opencode-ai).
# Install awscli for S3/R2 hydration + sync.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 awscli \
  && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (required for SDK to spawn server)
# Clean up unused musl binary (saves ~120MB)
RUN npm install -g opencode-ai@1.3.9 \
  && rm -rf /usr/local/lib/node_modules/opencode-ai/node_modules/*musl* \
  && npm cache clean --force \
  && rm -rf /root/.npm/_logs /tmp/node-compile-cache

# Configure git for automated commits (required for OpenCode undo/revert)
RUN git config --global user.email "studio@vivd.local" \
  && git config --global user.name "Vivd Studio"

# Stage 1: Dependencies (workspace-aware)
FROM base AS deps

# Install deps for just the studio workspace (+ theme) via root workspaces/lockfile
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/plugin-analytics/package.json packages/plugin-analytics/package.json
COPY packages/plugin-contact-form/package.json packages/plugin-contact-form/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/studio/package.json packages/studio/package.json

RUN npm ci -w @vivd/shared -w @vivd/theme -w @vivd/plugin-analytics -w @vivd/plugin-contact-form -w @vivd/cli -w @vivd/studio --include-workspace-root=false \
  && npm cache clean --force \
  && rm -rf /root/.npm/_logs /tmp/node-compile-cache

# Stage 2: Development
FROM deps AS dev
COPY packages/shared ./packages/shared
COPY packages/theme ./packages/theme
COPY packages/plugin-analytics ./packages/plugin-analytics
COPY packages/plugin-contact-form ./packages/plugin-contact-form
COPY packages/cli ./packages/cli
COPY packages/studio ./packages/studio

# Ensure shared is built (runtime imports come from `@vivd/shared/dist/*`)
RUN npm run build -w @vivd/shared
RUN npm run build -w @vivd/cli

WORKDIR /app/packages/studio
COPY packages/studio/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY packages/studio/selfHostDefaults.sh /usr/local/bin/selfHostDefaults.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/selfHostDefaults.sh
RUN printf '%s\n' '#!/bin/sh' 'exec node /app/packages/cli/dist/index.js "$@"' > /usr/local/bin/vivd \
  && chmod +x /usr/local/bin/vivd
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3100 3101
CMD ["npm", "run", "dev"]

# Stage 3: Build
FROM deps AS build
COPY packages/shared ./packages/shared
COPY packages/theme ./packages/theme
COPY packages/plugin-analytics ./packages/plugin-analytics
COPY packages/plugin-contact-form ./packages/plugin-contact-form
COPY packages/cli ./packages/cli
COPY packages/studio ./packages/studio

RUN npm run build -w @vivd/shared
RUN npm run build -w @vivd/cli
RUN npm run build -w @vivd/studio

# Stage 4: Production
FROM base AS prod

ARG VIVD_IMAGE_VERSION=unknown
ARG VIVD_IMAGE_REVISION=unknown
LABEL org.opencontainers.image.version=$VIVD_IMAGE_VERSION
LABEL org.opencontainers.image.revision=$VIVD_IMAGE_REVISION

# Install production deps for the studio workspace (links theme as a workspace dep)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/studio/package.json packages/studio/package.json

RUN npm ci -w @vivd/shared -w @vivd/cli -w @vivd/studio --omit=dev --include-workspace-root=false \
  && npm cache clean --force \
  && rm -rf /root/.npm/_logs /tmp/node-compile-cache

# Copy shared package (runtime dependency)
COPY packages/shared ./packages/shared
COPY packages/cli ./packages/cli

# Copy built outputs
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/studio/dist ./packages/studio/dist

WORKDIR /app/packages/studio
COPY packages/studio/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY packages/studio/selfHostDefaults.sh /usr/local/bin/selfHostDefaults.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/selfHostDefaults.sh
RUN printf '%s\n' '#!/bin/sh' 'exec node /app/packages/cli/dist/index.js "$@"' > /usr/local/bin/vivd \
  && chmod +x /usr/local/bin/vivd
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3100
CMD ["npm", "start"]
