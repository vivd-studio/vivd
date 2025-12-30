# Stage 1: Development (for local dev with hot reload)
FROM node:23-slim AS dev
WORKDIR /app

# Install git (required for version control features)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (required for SDK to spawn server)
RUN npm install -g opencode-ai && npm cache clean --force

# Configure git for automated commits (required for OpenCode undo/revert)
RUN git config --global user.email "generator@vivd.local" \
    && git config --global user.name "Vivd Generator"

COPY package*.json ./
RUN npm install && npm cache clean --force
COPY . .
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 2: Build (compile TypeScript)
FROM node:23-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: Production (minimal runtime image)
FROM node:23-slim AS prod
WORKDIR /app

# Install git (required for version control features)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (required for SDK to spawn server)
RUN npm install -g opencode-ai && npm cache clean --force

# Configure git for automated commits (required for OpenCode undo/revert)
RUN git config --global user.email "generator@vivd.local" \
    && git config --global user.name "Vivd Generator"

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from builder stage
COPY --from=builder /app/dist ./dist

# Copy drizzle migrations (needed at runtime)
COPY --from=builder /app/drizzle ./drizzle

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3000
CMD ["npm", "start"]
