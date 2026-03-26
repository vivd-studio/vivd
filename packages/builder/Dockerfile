FROM node:23-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/builder/package.json packages/builder/package.json
RUN npm ci -w @vivd/builder --include-workspace-root=false \
  && npm cache clean --force

FROM deps AS build
COPY packages/builder ./packages/builder
RUN npm run build -w @vivd/builder

FROM base AS prod
COPY package.json package-lock.json ./
COPY packages/builder/package.json packages/builder/package.json
RUN npm ci -w @vivd/builder --omit=dev --include-workspace-root=false \
  && npm cache clean --force

COPY --from=build /app/packages/builder/dist ./packages/builder/dist
WORKDIR /app/packages/builder
CMD ["node", "dist/cli.js"]
