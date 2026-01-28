# Stage 1: Dependencies (workspace-aware)
FROM node:23-slim AS deps
WORKDIR /app

# Install git and ca-certificates (required for version control features and SSL)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (required for SDK to spawn server)
# Clean up unused musl binary (saves ~120MB)
RUN npm install -g opencode-ai@1.1.28 \
    && rm -rf /usr/local/lib/node_modules/opencode-ai/node_modules/*musl* \
    && npm cache clean --force

# Configure git for automated commits (required for OpenCode undo/revert)
RUN git config --global user.email "generator@vivd.local" \
    && git config --global user.name "Vivd Generator"

# Install deps for just the studio backend (+ shared) via root workspaces/lockfile
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/theme/package.json packages/theme/package.json

COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci -w @vivd/shared -w @vivd/backend --include-workspace-root=false \
    && npm cache clean --force

# Stage 2: Development (hot reload)
FROM deps AS dev
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Ensure shared is built (runtime imports come from `@vivd/shared/dist/*`)
RUN npm run build -w @vivd/shared

WORKDIR /app/packages/backend
COPY packages/backend/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 3: Build (compile TypeScript)
FROM deps AS builder
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

RUN npm run build -w @vivd/shared
RUN npm run build -w @vivd/backend

# Template files are needed at runtime for AGENTS.md generation
RUN mkdir -p /app/packages/backend/dist/templates \
    && cp -R /app/packages/backend/src/generator/templates/* /app/packages/backend/dist/templates/

# Stage 4: Production (minimal runtime image)
FROM node:23-slim AS prod
WORKDIR /app

# Install git and ca-certificates (required for version control features and SSL)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (required for SDK to spawn server)
# Clean up unused musl binary (saves ~120MB)
RUN npm install -g opencode-ai@1.1.28 \
    && rm -rf /usr/local/lib/node_modules/opencode-ai/node_modules/*musl* \
    && npm cache clean --force

# Configure git for automated commits (required for OpenCode undo/revert)
RUN git config --global user.email "generator@vivd.local" \
    && git config --global user.name "Vivd Generator"

# Install production deps for the backend workspace (links shared as a workspace dep)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci -w @vivd/backend --omit=dev --include-workspace-root=false \
    && npm cache clean --force

# Copy built outputs
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
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
