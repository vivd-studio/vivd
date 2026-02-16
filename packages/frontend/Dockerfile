# Stage 1: Dependencies (workspace-aware)
FROM node:23-slim AS deps
WORKDIR /app

# Install deps for the studio frontend + backend types + shared via root workspaces/lockfile
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/studio/package.json packages/studio/package.json

COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci -w @vivd/shared -w @vivd/backend -w @vivd/theme -w @vivd/frontend --include-workspace-root=false

# Stage 2: Development
FROM deps AS dev
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/theme ./packages/theme
COPY packages/frontend ./packages/frontend

# Ensure shared is built (backend types import from `@vivd/shared/dist/*`)
RUN npm run build -w @vivd/shared

WORKDIR /app/packages/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# Stage 3: Build
FROM deps AS build
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/theme ./packages/theme
COPY packages/frontend ./packages/frontend

RUN npm run build -w @vivd/shared

ARG VITE_APP_ENV
ENV VITE_APP_ENV=${VITE_APP_ENV}
RUN npm run build -w @vivd/frontend

# Stage 4: Production
FROM nginx:alpine AS prod
COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html/vivd-studio
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
