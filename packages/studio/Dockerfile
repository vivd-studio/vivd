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
RUN npm install -g opencode-ai@1.3.2 \
  && rm -rf /usr/local/lib/node_modules/opencode-ai/node_modules/*musl* \
  && npm cache clean --force

# Configure git for automated commits (required for OpenCode undo/revert)
RUN git config --global user.email "studio@vivd.local" \
  && git config --global user.name "Vivd Studio"

# Stage 1: Dependencies (workspace-aware)
FROM base AS deps

# Install deps for just the studio workspace (+ theme) via root workspaces/lockfile
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json
COPY packages/studio/package.json packages/studio/package.json

RUN npm ci -w @vivd/shared -w @vivd/theme -w @vivd/studio --include-workspace-root=false \
  && npm cache clean --force

# Stage 2: Development
FROM deps AS dev
COPY packages/shared ./packages/shared
COPY packages/theme ./packages/theme
COPY packages/studio ./packages/studio

# Ensure shared is built (runtime imports come from `@vivd/shared/dist/*`)
RUN npm run build -w @vivd/shared

WORKDIR /app/packages/studio
COPY packages/studio/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3100 3101
CMD ["npm", "run", "dev"]

# Stage 3: Build
FROM deps AS build
COPY packages/shared ./packages/shared
COPY packages/theme ./packages/theme
COPY packages/studio ./packages/studio

RUN npm run build -w @vivd/shared
RUN npm run build -w @vivd/studio

# Stage 4: Production
FROM base AS prod

# Install production deps for the studio workspace (links theme as a workspace dep)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json
COPY packages/studio/package.json packages/studio/package.json

RUN npm ci -w @vivd/shared -w @vivd/studio --omit=dev --include-workspace-root=false \
  && npm cache clean --force

# Copy shared package (runtime dependency)
COPY packages/shared ./packages/shared

# Copy built outputs
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/studio/dist ./packages/studio/dist

WORKDIR /app/packages/studio
COPY packages/studio/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3100
CMD ["npm", "start"]
