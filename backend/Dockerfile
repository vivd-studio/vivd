# Stage 1: Base (Dependencies)
FROM node:23 AS base
WORKDIR /app

# Install opencode CLI (required for SDK to spawn server)
RUN npm install -g opencode-ai

# Configure git for automated commits (required for OpenCode undo/revert)
RUN git config --global user.email "generator@vivd.local" \
    && git config --global user.name "Vivd Generator"

COPY package*.json ./
RUN npm install
COPY . .
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Stage 2: Development
FROM base AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 3: Production
FROM base AS prod
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
