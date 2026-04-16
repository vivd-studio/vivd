FROM node:23-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY plugins/sdk/package.json plugins/sdk/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/builder/package.json packages/builder/package.json
RUN npm ci -w @vivd/plugin-sdk -w @vivd/shared -w @vivd/builder --include-workspace-root=false \
  && npm cache clean --force

FROM deps AS build
COPY plugins/sdk ./plugins/sdk
COPY packages/shared ./packages/shared
COPY packages/builder ./packages/builder
RUN npm run build -w @vivd/plugin-sdk \
  && npm run build -w @vivd/shared \
  && npm run build -w @vivd/builder

FROM base AS prod
COPY package.json package-lock.json ./
COPY plugins/sdk/package.json plugins/sdk/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/builder/package.json packages/builder/package.json
RUN npm ci -w @vivd/plugin-sdk -w @vivd/shared -w @vivd/builder --omit=dev --include-workspace-root=false \
  && npm cache clean --force

COPY --from=build /app/plugins/sdk/dist ./plugins/sdk/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/builder/dist ./packages/builder/dist
WORKDIR /app/packages/builder
CMD ["node", "dist/cli.js"]
