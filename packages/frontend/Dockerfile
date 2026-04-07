# Stage 1: Dependencies (workspace-aware)
FROM node:23-slim AS deps
WORKDIR /app

# Install deps for the frontend + backend types + shared/builder workspace packages via the root lockfile
COPY package.json package-lock.json ./
COPY packages/builder/package.json packages/builder/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/plugin-analytics/package.json packages/plugin-analytics/package.json
COPY packages/plugin-contact-form/package.json packages/plugin-contact-form/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/studio/package.json packages/studio/package.json

COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci -w @vivd/builder -w @vivd/shared -w @vivd/backend -w @vivd/plugin-analytics -w @vivd/plugin-contact-form -w @vivd/theme -w @vivd/frontend --include-workspace-root=false

# Stage 2: Development
FROM deps AS dev
COPY packages/builder ./packages/builder
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/plugin-analytics ./packages/plugin-analytics
COPY packages/plugin-contact-form ./packages/plugin-contact-form
COPY packages/theme ./packages/theme
COPY packages/frontend ./packages/frontend

# Ensure shared/builder are built for workspace package resolution inside the image.
RUN npm run build -w @vivd/builder
RUN npm run build -w @vivd/shared

WORKDIR /app/packages/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# Stage 3: Build
FROM deps AS build
COPY packages/builder ./packages/builder
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/plugin-analytics ./packages/plugin-analytics
COPY packages/plugin-contact-form ./packages/plugin-contact-form
COPY packages/theme ./packages/theme
COPY packages/frontend ./packages/frontend

RUN npm run build -w @vivd/builder
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
