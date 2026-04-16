# Stage 1: Dependencies (workspace-aware)
FROM node:23-slim AS deps
WORKDIR /app

# Install deps for the frontend + backend types + shared/builder workspace packages via the root lockfile
COPY package.json package-lock.json ./
COPY plugins/installed/package.json plugins/installed/package.json
COPY plugins/sdk/package.json plugins/sdk/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY plugins/native/analytics/package.json plugins/native/analytics/package.json
COPY plugins/native/contact-form/package.json plugins/native/contact-form/package.json
COPY plugins/native/newsletter/package.json plugins/native/newsletter/package.json
COPY plugins/native/table-booking/package.json plugins/native/table-booking/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/studio/package.json packages/studio/package.json

COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci -w @vivd/plugin-sdk -w @vivd/shared -w @vivd/installed-plugins -w @vivd/backend -w @vivd/plugin-analytics -w @vivd/plugin-contact-form -w @vivd/plugin-newsletter -w @vivd/plugin-table-booking -w @vivd/theme -w @vivd/frontend --include-workspace-root=false

# Stage 2: Development
FROM deps AS dev
COPY plugins/installed ./plugins/installed
COPY plugins/sdk ./plugins/sdk
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY plugins/native/analytics ./plugins/native/analytics
COPY plugins/native/contact-form ./plugins/native/contact-form
COPY plugins/native/newsletter ./plugins/native/newsletter
COPY plugins/native/table-booking ./plugins/native/table-booking
COPY packages/theme ./packages/theme
COPY packages/frontend ./packages/frontend

# Ensure shared is built for workspace package resolution inside the image.
RUN npm run build -w @vivd/plugin-sdk
RUN npm run build -w @vivd/shared

WORKDIR /app/packages/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# Stage 3: Build
FROM deps AS build
COPY plugins/installed ./plugins/installed
COPY plugins/sdk ./plugins/sdk
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY plugins/native/analytics ./plugins/native/analytics
COPY plugins/native/contact-form ./plugins/native/contact-form
COPY plugins/native/newsletter ./plugins/native/newsletter
COPY plugins/native/table-booking ./plugins/native/table-booking
COPY packages/theme ./packages/theme
COPY packages/frontend ./packages/frontend

RUN npm run build -w @vivd/plugin-sdk
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
