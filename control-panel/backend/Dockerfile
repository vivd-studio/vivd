# Development dependencies
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Build
FROM backend-deps AS backend-build
COPY . .
RUN npm run build

# Production
FROM node:22-alpine AS backend
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/drizzle ./drizzle
COPY package.json ./
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
EXPOSE 3100
CMD ["node", "dist/index.js"]
